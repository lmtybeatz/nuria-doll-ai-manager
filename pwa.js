(() => {
  const installButton = document.getElementById('pwaInstallBtn');
  if (!installButton) return;

  let installPrompt = null;
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  const hideButton = () => {
    installButton.hidden = true;
    installButton.setAttribute('aria-hidden', 'true');
  };
  const showButton = () => {
    installButton.hidden = false;
    installButton.setAttribute('aria-hidden', 'false');
  };

  // Ne jamais afficher la commande lorsque l'application est déjà installée.
  if (isStandalone()) hideButton();
  else if (isIOS) showButton();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    if (!isStandalone()) showButton();
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
        await installPrompt.userChoice;
        // Le bouton ne reste pas flottant après la décision de l'utilisateur.
        installPrompt = null;
        hideButton();
      } catch (error) {
        console.error('Installation PWA indisponible :', error);
        window.alert('L’installation n’a pas pu démarrer. Essaie depuis le menu de ton navigateur.');
      } finally {
        installButton.disabled = false;
      }
      return;
    }

    if (isIOS) {
      window.alert('Pour installer NURIA DOLL AI MANAGER sur iPhone ou iPad :\n\n1. Ouvre cette page dans Safari.\n2. Appuie sur le bouton Partager.\n3. Choisis « Sur l’écran d’accueil ».\n4. Appuie sur « Ajouter ».');
    }
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .catch((error) => console.error('Service worker non enregistré :', error));
    });
  }
})();