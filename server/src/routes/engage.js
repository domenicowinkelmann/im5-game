import { Router } from 'express';
import { ADS, NUDGE, PRIVACY, PLACEMENTS, OUTCOMES, STATS_OUTCOMES } from '../../../src/shared/economy.js';
import { decide } from '../../../src/shared/engagement.js';
import { tx, lockUser } from '../db.js';
import { ApiError, MSG } from '../errors.js';
import { evaluate } from '../analytics/profiles.js';

const DECISION_ID = /^[1-9][0-9]{0,15}$/;
const num = (v) => (v == null ? null : Number(v));

function cleanFacts(facts) {
  const f = facts !== null && typeof facts === 'object' && !Array.isArray(facts) ? facts : {};
  return {
    hour: Number.isInteger(f.hour) && f.hour >= 0 && f.hour <= 23 ? f.hour : null,
    newHighscore: f.newHighscore === true,
    newItem: f.newItem === true,
  };
}

async function loadContext(conn, uid, facts) {
  const u = await lockUser(conn, uid,
    `username, session_no, total_runs, coins, (play_flight_ms + play_slot_ms) DIV 1000 AS play_s,
     consent_version, consent_stats, consent_personal, TIMESTAMPDIFF(SECOND, session_started_at, NOW(3)) AS session_s`);
  const consent = {
    decided: u.consent_version === PRIVACY.version,
    stats: u.consent_stats === 1,
    personal: u.consent_personal === 1,
  };
  if (!consent.decided) return { u, ctx: { consent } };
  const [d] = await conn.query(
    `SELECT
       COALESCE(SUM(kind = 'interstitial' AND session_no = ?), 0) AS ad_session,
       COALESCE(SUM(kind = 'interstitial' AND created_at > NOW(3) - INTERVAL 1 DAY), 0) AS ad_day,
       TIMESTAMPDIFF(SECOND, MAX(IF(kind = 'interstitial', created_at, NULL)), NOW(3)) AS ad_ago,
       COALESCE(SUM(kind = 'nudge' AND session_no = ?), 0) AS nudge_session,
       COALESCE(SUM(kind = 'nudge' AND created_at > NOW(3) - INTERVAL 1 DAY), 0) AS nudge_day,
       TIMESTAMPDIFF(SECOND, MAX(IF(kind = 'nudge', created_at, NULL)), NOW(3)) AS nudge_ago,
       COALESCE(SUM(kind = 'nudge' AND outcome = 'dismissed' AND created_at > NOW(3) - INTERVAL ? HOUR), 0) AS dismissed
     FROM decisions
     WHERE user_id = ? AND shown = 1 AND (created_at > NOW(3) - INTERVAL ? HOUR OR session_no = ?)`,
    [u.session_no, u.session_no, NUDGE.dismissWindowHours, uid, NUDGE.dismissWindowHours, u.session_no],
  );
  const [since] = await conn.query(
    `SELECT COUNT(r.id) AS n, MAX(t.at) IS NULL AS never
     FROM (SELECT MAX(created_at) AS at FROM decisions WHERE user_id = ? AND kind = 'interstitial' AND shown = 1) t
     LEFT JOIN runs r ON r.user_id = ? AND r.created_at > t.at`,
    [uid, uid],
  );
  const [run] = await conn.query('SELECT duration_ms FROM runs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [uid]);
  const [rewarded] = await conn.query(
    'SELECT TIMESTAMPDIFF(SECOND, MAX(doubled_at), NOW(3)) AS ago FROM runs WHERE user_id = ?',
    [uid],
  );
  const [{ n: extraItems }] = await conn.query('SELECT COUNT(*) AS n FROM inventory WHERE user_id = ?', [uid]);
  let segments = [];
  let avgSessionSeconds = null;
  if (consent.personal) {
    const p = await evaluate(conn, uid);
    if (p) {
      segments = p.segments;
      const { completedCount, completedAvgS } = p.metrics.sessions;
      avgSessionSeconds = completedCount >= NUDGE.progressMinSessions ? completedAvgS : null;
    }
  }
  return {
    u,
    ctx: {
      consent,
      guest: u.username === null,
      hour: facts.hour,
      sessionNo: u.session_no,
      sessionSeconds: num(u.session_s),
      runs: u.total_runs,
      playSeconds: Number(u.play_s),
      coins: u.coins,
      extraItems,
      lastRunSeconds: run ? run.duration_ms / 1000 : null,
      rewardedSecondsAgo: num(rewarded.ago),
      interstitials: { session: num(d.ad_session), day: num(d.ad_day), secondsAgo: num(d.ad_ago), runsSince: since.never ? u.total_runs : Number(since.n) },
      nudges: { session: num(d.nudge_session), day: num(d.nudge_day), secondsAgo: num(d.nudge_ago), dismissed: num(d.dismissed) },
      segments,
      avgSessionSeconds,
      facts: { newHighscore: facts.newHighscore, newItem: facts.newItem },
    },
  };
}

async function logDecision(conn, uid, sessionNo, placement, entry, shown) {
  const { insertId } = await conn.query(
    `INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, personalized)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uid, sessionNo, placement, entry.kind, shown ? 1 : 0, entry.reason, entry.personalized ? 1 : 0],
  );
  return insertId;
}

async function saveOutcome(conn, uid, id, outcome) {
  const user = await lockUser(conn, uid, 'consent_stats');
  const [d] = await conn.query('SELECT kind FROM decisions WHERE id = ? AND user_id = ? AND shown = 1 AND outcome IS NULL', [id, uid]);
  if (!d || (OUTCOMES[outcome] !== null && OUTCOMES[outcome] !== d.kind)) return false;
  const stats = user.consent_stats === 1;
  if (outcome === 'dropped') {
    await conn.query(
      stats ? "UPDATE decisions SET shown = 0, outcome = 'dropped', outcome_at = NOW(3) WHERE id = ?" : 'DELETE FROM decisions WHERE id = ?',
      [id],
    );
  } else if (stats || !STATS_OUTCOMES.includes(outcome)) {
    await conn.query('UPDATE decisions SET outcome = ?, outcome_at = NOW(3) WHERE id = ?', [outcome, id]);
  }
  return true;
}

export function engageRoutes({ pool, limits, auth }) {
  const r = Router();

  r.post('/engage', auth, limits.play, async (req, res) => {
    const placement = req.body?.placement;
    if (!PLACEMENTS.includes(placement)) throw new ApiError(400, MSG.badRequest);
    const facts = cleanFacts(req.body?.facts);
    const uid = req.user.id;
    res.json(await tx(pool, async (conn) => {
      const { u, ctx } = await loadContext(conn, uid, facts);
      const d = decide(placement, ctx);
      const out = { interstitial: null, nudge: null };
      if (d.interstitial) {
        const id = await logDecision(conn, uid, u.session_no, placement, { kind: 'interstitial', ...d.interstitial }, true);
        out.interstitial = { id, seconds: ADS.interstitial.seconds };
      }
      if (d.nudge) {
        const id = await logDecision(conn, uid, u.session_no, placement, { kind: 'nudge', ...d.nudge }, true);
        out.nudge = { id, reason: d.nudge.reason };
      }
      if (ctx.consent.stats) {
        for (const entry of d.skipped) await logDecision(conn, uid, u.session_no, placement, entry, false);
      }
      return out;
    }));
  });

  r.post('/engage/:id', auth, limits.play, async (req, res) => {
    const outcome = req.body?.outcome;
    if (typeof outcome !== 'string' || !Object.hasOwn(OUTCOMES, outcome)) throw new ApiError(400, MSG.badRequest);
    if (!DECISION_ID.test(req.params.id)) throw new ApiError(404, MSG.notFound);
    const saved = await tx(pool, (conn) => saveOutcome(conn, req.user.id, req.params.id, outcome));
    if (!saved) throw new ApiError(404, MSG.notFound);
    res.json({ ok: true });
  });

  return r;
}
