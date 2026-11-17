export async function showRewardedAd(ui) {
  return ui.fakeAd(3);
}

export async function showInterstitial(ui, d) {
  return ui.fakeAd(d.seconds, 'interstitial');
}
