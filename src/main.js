import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';
import { mountShell } from './ui/shell.js';
import { createRouter } from './lib/router.js';

const shell = mountShell(document.getElementById('app'));
const router = createRouter({
  outlet: shell.outlet,
  onRoute: (id) => shell.setActive(id)
});
router.mount();
