(() => {
  const installButton = document.getElementById('pwaInstallBtn');
  if (!installButton) return;

  let installPrompt = null;
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const hideButton = () => {
    installButton.hidden = true;
    installButton.setAttribute('aria-hidden', 'true');
  };

  if (isStandalone()) {
    hideButton();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
    installButton.setAttribute('aria-hidden', 'false');
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    hideButton();
  });

  installButton.addEventListener('click', async () => {
    if (isStandalone()) {
      hideButton();
      return;
    }

    if (installPrompt) {
      installButton.disabled = true;
      try {
        installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') hideButton();
      } catch (error) {
        console.error('Installation PWA indisponible :', error);
        window.alert('L’installation n’a pas pu démarrer. Essaie depuis le menu de ton navigateur.');
      } finally {
        installPrompt = null;
        installButton.disabled = false;
      }
      return;
    }

    const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    if (isIOS) {
      window.alert('Pour installer NURIA DOLL AI MANAGER sur iPhone ou iPad :\n\n1. Ouvre cette page dans Safari.\n2. Appuie sur le bouton Partager.\n3. Choisis « Sur l’écran d’accueil ».\n4. Appuie sur « Ajouter ».');
    } else {
      window.alert('Pour installer NURIA DOLL AI MANAGER :\n\nOuvre le menu de ton navigateur (Chrome ou Edge), puis choisis « Installer l’application » ou « Ajouter à l’écran d’accueil ».');
    }
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .catch((error) => console.error('Service worker non enregistré :', error));
    });
  }
})();