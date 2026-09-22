import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/identity.css';
import './styles/live-hero.css';
import './styles/newsroom.css';
import './styles/newsroom-article.css';
import './styles/winba-board.css';
import './styles/editorial-charts.css';
import './styles/newsroom-hero-grid.css';
import './styles/international.css';
import './styles/pbe.css';
import './styles/pbe-flagship.css';
import './styles/player-load.css';
import './styles/pro-intelligence.css';
import './styles/prop-edge.css';
import './styles/polish.css';
import './styles/no-scrollbars.css';
import { mountShell } from './ui/shell.js';
import { enhanceProMore } from './ui/pro-more.js';
import { createRouter } from './lib/router.js';

const shell = mountShell(document.getElementById('app'));
enhanceProMore(document);
const router = createRouter({
  outlet: shell.outlet,
  onRoute: (id) => shell.setActive(id)
});
router.mount();
