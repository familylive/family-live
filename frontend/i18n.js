// ==================== i18n System ====================
const i18n = {
  lang: 'ar',
  strings: {},
  
  async init() {
    this.lang = localStorage.getItem('family-lang') || 'ar';
    await this.load(this.lang);
    return this.lang;
  },
  
  async load(lang) {
    try {
      const res = await fetch(`/lang/${lang}.json`);
      this.strings = await res.json();
      this.lang = lang;
      localStorage.setItem('family-lang', lang);
      this.apply();
    } catch(e) {
      console.error('Failed to load language:', e);
    }
  },
  
  async switch(lang) {
    await this.load(lang);
    this.applyDir();
    // Update UI
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const translation = this.t(key);
      if (translation) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.placeholder = translation;
        } else {
          el.textContent = translation;
        }
      }
    });
    // Translate menu items by data-page
    const pageKeys = { dashboard:'nav.home', family:'nav.family', diwaniya:'nav.diwaniya', games:'nav.games', challenges:'nav.challenges', leaderboard:'nav.leaderboard', codes:'nav.codes', auctions:'nav.auctions', profile:'nav.profile', support:'nav.support', myviolations:'nav.violations', moderator:'nav.moderator' };
    document.querySelectorAll('.menu-nav-item[data-page]').forEach(item => {
      const key = pageKeys[item.dataset.page];
      const icon = item.querySelector('.nav-icon');
      const t = this.t(key);
      if (t && t !== key) {
        item.childNodes.forEach(n => { if (n.nodeType === 3 && n.textContent.trim()) n.textContent = t; });
      }
    });
    // Translate login/register menu items
    document.querySelectorAll('#menu-login-item, #menu-register-item, #menu-about-item, #menu-privacy-item, #menu-support-visitor').forEach(item => {
      const icon = item.querySelector('.nav-icon');
      const t = item.id === 'menu-login-item' ? this.t('auth.login') : item.id === 'menu-register-item' ? this.t('auth.register') : item.textContent;
      if (item.id === 'menu-login-item') item.childNodes.forEach(n => { if (n.nodeType === 3 && n.textContent.trim()) n.textContent = t; });
      if (item.id === 'menu-register-item') item.childNodes.forEach(n => { if (n.nodeType === 3 && n.textContent.trim()) n.textContent = t; });
    });
    // Translate current page title
    const active = document.querySelector('.page-content.active');
    if (active) {
      const pageName = active.id.replace('page-', '');
      const titleKeys = { dashboard:'dashboard.title', family:'family.title', diwaniya:'diwaniya.title', games:'games.title', challenges:'challenges.title', leaderboard:'leaderboard.title', codes:'nav.codes', auctions:'nav.auctions', profile:'nav.profile', support:'nav.support', myviolations:'nav.violations', wallet:'nav.wallet' };
      const titleEl = document.querySelector('.page-content.active .page-title');
      const t = this.t(titleKeys[pageName]);
      if (titleEl && t && t !== titleKeys[pageName]) titleEl.textContent = t;
    }
    // Update header title
    const headerTitle = document.getElementById('header-title-text');
    if (headerTitle && !headerTitle.dataset.i18n) {
      // Preserve dynamic titles for pages
    }
    // Dispatch event for dynamic components
    document.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
  },
  
  t(key) {
    return this.strings[key] || key;
  },
  
  apply() {
    document.documentElement.lang = this.lang === 'ar' ? 'ar' : 'en';
    this.applyDir();
  },
  
  applyDir() {
    document.documentElement.dir = this.lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.classList.toggle('ltr', this.lang === 'en');
  }
};

// Shortcut function
function __(key) { return i18n.t(key); }

// Auto-init
i18n.init();
