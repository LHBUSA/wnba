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
import './styles/article-analytics.css';
import './styles/newsroom-hero-grid.css';
import './styles/international.css';
import './styles/pbe.css';
import './styles/pbe-flagship.css';
import './styles/player-load.css';
import './styles/player-dna.css';
import './styles/pro-intelligence.css';
import './styles/prop-edge.css';
import './styles/pbe-membership.css';
import './styles/all-access.css';
import './styles/playoffs.css';
import './styles/polish.css';
import './styles/no-scrollbars.css';
import { mountShell } from './ui/shell.js';
import { installPhotoFallback } from './ui/photo.js';
import { enhanceProMore } from './ui/pro-more.js';
import { bindShareActions } from './ui/share.js';
import { createRouter } from './lib/router.js';
import { initAnalytics, trackPageView } from './analytics.js';
import { api } from './data/api.js';
import { membershipFrom } from './lib/membership.js';

initAnalytics();
installPhotoFallback();
const shell = mountShell(document.getElementById('app'));
enhanceProMore(document);
bindShareActions(document);
// One account read on boot: the header/footer follow the server's membership verdict (members see their badge;
// free visitors keep the neutral "WNBA Pro" link, so nothing flickers while the read is in flight).
api.account().then((res) => shell.setMembership(membershipFrom(res)));
const router = createRouter({
  outlet: shell.outlet,
  onRoute: (id) => shell.setActive(id),
  onMounted: ({ routeId, path }) => trackPageView({ routeId, path })
});
router.mount();
