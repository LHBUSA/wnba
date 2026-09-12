import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/identity.css';
import './styles/newsroom.css';
import './styles/video.css';
import { mountShell } from './ui/shell.js';
import { createRouter } from './lib/router.js';
import { wireVideo } from './ui/video.js';

wireVideo();
const shell = mountShell(document.getElementById('app'));
const router = createRouter({
  outlet: shell.outlet,
  onRoute: (id) => shell.setActive(id)
});
router.mount();
