import './style.css';
import { Game } from './game/Game.js';
import { UI } from './ui/ui.js';

const ui = new UI();
const game = new Game(document.getElementById('scene'), ui);
ui.bind(game);
game.init();
