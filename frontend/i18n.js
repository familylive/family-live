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
