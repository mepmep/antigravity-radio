/**
 * MyRadio - Progressive Web App (PWA) Live Audio Engine
 * Control de reproducción en vivo, consumo adaptable de API de metadata,
 * temporizador de apagado con corte de datos y MediaSession API.
 */

// ==========================================
// 1. CONFIGURACIÓN Y CONSTANTES
// ==========================================
const CONFIG = {
  STREAM_URL: 'https://az03.streaminghd.net.ar:8084/stream;',
  METADATA_URL: 'https://az03.streaminghd.net.ar/api/nowplaying/8084',
  CORS_PROXY: 'https://api.allorigins.win/raw?url=',
  POLL_INTERVAL: 12000,
  DEFAULT_TITLE: 'MyRadio En Vivo',
  DEFAULT_ARTIST: 'MyRadio Online',
  DEFAULT_ARTWORK: 'logo.png',
  FALLBACK_ICON: 'icons/icon-512.svg'
};

// ==========================================
// 2. ESTADO GLOBAL DE LA APLICACIÓN
// ==========================================
const state = {
  isPlaying: false,
  isLoading: false,
  isMuted: false,
  volume: 1,
  currentTitle: '',
  currentArtist: '',
  currentArt: '',
  currentListeners: null,
  
  // Sleep Timer
  timerSecondsLeft: null,
  timerIntervalId: null,
  
  // Metadata interval
  metadataIntervalId: null,
  
  // PWA Install Prompt
  deferredPrompt: null
};

// ==========================================
// 3. ELEMENTOS DEL DOM
// ==========================================
const dom = {
  audio: document.getElementById('audio-player'),
  playBtn: document.getElementById('play-btn'),
  playIcon: document.getElementById('play-icon'),
  pauseIcon: document.getElementById('pause-icon'),
  loadingSpinner: document.getElementById('loading-spinner'),
  stopBtn: document.getElementById('stop-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  
  artworkImg: document.getElementById('artwork-img'),
  artworkAmbient: document.getElementById('artwork-ambient'),
  trackTitle: document.getElementById('sonic_title') || document.querySelector('.cc_streaminfo[data-type="song"]'),
  trackArtist: document.getElementById('track-artist') || document.querySelector('.cc_streaminfo[data-type="artist"]'),
  
  statusBadge: document.getElementById('status-badge'),
  statusText: document.getElementById('status-text'),
  liveDot: document.getElementById('live-dot'),
  
  listenersBadge: document.getElementById('listeners-badge'),
  listenersCount: document.getElementById('listeners-count'),
  visualizerBars: document.getElementById('visualizer-bars'),
  
  volumeSlider: document.getElementById('volume-slider'),
  volumeBtn: document.getElementById('volume-btn'),
  volumeHighIcon: document.getElementById('volume-high-icon'),
  volumeMuteIcon: document.getElementById('volume-mute-icon'),
  volumePercent: document.getElementById('volume-percent'),
  
  timerBtn: document.getElementById('timer-btn') || document.getElementById('sleep-timer-btn'),
  timerBadge: document.getElementById('timer-badge'),
  timerBadgeText: document.getElementById('timer-badge-text'),
  timerModal: document.getElementById('timer-modal'),
  closeTimerModal: document.getElementById('close-timer-modal'),
  cancelTimerBtn: document.getElementById('cancel-timer-btn'),
  modalCountdown: document.getElementById('modal-countdown'),
  timerPresetBtns: document.querySelectorAll('.timer-preset-btn'),
  
  shareBtn: document.getElementById('share-btn'),
  pwaInstallBtn: document.getElementById('pwa-install-btn'),
  offlineBanner: document.getElementById('offline-banner'),
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message'),
  toastIcon: document.getElementById('toast-icon'),
  currentYear: document.getElementById('current-year')
};

// ==========================================
// 4. MOTOR DE AUDIO
// ==========================================
function playStream() {
  setLoadingState(true);
  updateStatus('connecting', 'Conectando...');

  dom.audio.src = CONFIG.STREAM_URL;

  const playPromise = dom.audio.play();

  if (playPromise !== undefined) {
    playPromise
      .then(() => {
        state.isPlaying = true;
        setLoadingState(false);
        updatePlaybackUI(true);
        updateStatus('live', 'En Vivo');
        updateMediaSessionPlayback('playing');
        syncFromWidgetDOM();
      })
      .catch((err) => {
        console.warn('Error o bloqueo de reproducción:', err);
        setLoadingState(false);
        updatePlaybackUI(false);
        if (err.name !== 'NotAllowedError') {
          updateStatus('error', 'Reintentar');
        } else {
          updateStatus('idle', 'Detenido');
        }
      });
  }
}

function pauseStream() {
  dom.audio.pause();
  state.isPlaying = false;
  setLoadingState(false);
  updatePlaybackUI(false);
  updateStatus('paused', 'Pausado');
  updateMediaSessionPlayback('paused');
}

function stopStream(notifyUser = false) {
  dom.audio.pause();
  dom.audio.removeAttribute('src');
  dom.audio.load();

  state.isPlaying = false;
  setLoadingState(false);
  updatePlaybackUI(false);
  updateStatus('idle', 'Detenido');
  updateMediaSessionPlayback('none');

  if (notifyUser) {
    showToast('Transmisión desconectada (Datos cortados)', '🛑');
  }
}

function togglePlayPause() {
  if (state.isPlaying) {
    pauseStream();
  } else {
    playStream();
  }
}

function refreshStream() {
  stopStream(false);
  setTimeout(() => {
    playStream();
    showToast('Reconectando señal en vivo...', '🔄');
  }, 150);
}

// ==========================================
// 5. EVENTOS NATIVOS DE <AUDIO>
// ==========================================
function setupAudioEvents() {
  if (!dom.audio) return;

  dom.audio.addEventListener('play', () => {
    if (dom.statusBadge) dom.statusBadge.classList.add('hidden');
  });

  dom.audio.addEventListener('playing', () => {
    state.isPlaying = true;
    setLoadingState(false);
    updatePlaybackUI(true);
    updateStatus('live', 'En Vivo');
    if (dom.statusBadge) dom.statusBadge.classList.add('hidden');
  });

  dom.audio.addEventListener('waiting', () => {
    setLoadingState(true);
    if (dom.statusBadge) dom.statusBadge.classList.add('hidden');
  });

  dom.audio.addEventListener('stalled', () => {
    if (state.isPlaying && dom.statusBadge) {
      dom.statusBadge.classList.add('hidden');
    }
  });

  dom.audio.addEventListener('pause', () => {
    if (dom.statusBadge) dom.statusBadge.classList.add('hidden');
  });

  dom.audio.addEventListener('error', (e) => {
    console.error('Audio playback error:', e);
    setLoadingState(false);
    updatePlaybackUI(false);
    updateStatus('error', 'Error señal');
    showToast('Error de señal. Intentando reconectar...', '⚠️');
  });
}

// ==========================================
// 6. SINCRONIZACIÓN DE METADATA
// ==========================================
function syncFromWidgetDOM() {
  const songElement = 
    document.getElementById('sonic_title') || 
    document.querySelector('.cc_streaminfo[data-type="song"]');
  
  let rawSongText = songElement ? (songElement.textContent || songElement.innerText || '') : '';
  rawSongText = cleanString(rawSongText);

  let title = '';
  let artist = '';

  if (rawSongText && rawSongText !== 'Cargando...' && rawSongText !== 'MyRadio En Vivo' && !rawSongText.toLowerCase().includes('offline')) {
    if (rawSongText.includes(' - ')) {
      const parts = rawSongText.split(' - ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    } else {
      title = rawSongText;
      artist = CONFIG.DEFAULT_ARTIST;
    }
  } else if (rawSongText.toLowerCase().includes('offline')) {
    title = 'MyRadio En Vivo';
    artist = 'Transmisión fuera de aire';
  } else {
    title = CONFIG.DEFAULT_TITLE;
    artist = CONFIG.DEFAULT_ARTIST;
  }

  let artUrl = '';
  const artImg = 
    document.querySelector('#sonic_art_full img') || 
    document.querySelector('#sonic_art img') ||
    document.querySelector('.cc_streaminfo[data-type="trackimageurl"] img') ||
    document.querySelector('.cc_streaminfo[data-type="image"] img');

  if (artImg && artImg.src) {
    artUrl = artImg.src;
  } else {
    const textUrlElem = document.querySelector('.cc_streaminfo[data-type="trackimageurl"]');
    if (textUrlElem && textUrlElem.textContent && isValidUrl(textUrlElem.textContent.trim())) {
      artUrl = textUrlElem.textContent.trim();
    }
  }

  if (artUrl && artUrl.includes('nodj.png')) {
    artUrl = CONFIG.DEFAULT_ARTWORK;
  } else if (!artUrl || !isValidUrl(artUrl)) {
    artUrl = CONFIG.DEFAULT_ARTWORK;
  }

  const listenersElem = 
    document.getElementById('sonic_listeners') || 
    document.querySelector('.cc_streaminfo[data-type="listeners"]');
  
  let listeners = null;
  if (listenersElem) {
    const text = listenersElem.textContent?.trim();
    if (text && !isNaN(text)) {
      listeners = parseInt(text, 10);
    }
  }

  updateMetadataUI(title, artist, artUrl, listeners);
  purgeRetryBadges();
}

function purgeRetryBadges() {
  const retryElements = document.querySelectorAll(
    '.cc_streaminfo_badge, [class*="reintentar" i], [id*="reintentar" i], [class*="cc_status"], [id*="status-badge"], .cc_reintentar'
  );
  retryElements.forEach((el) => {
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.remove();
  });

  const allSpansAndBtns = document.querySelectorAll('main button span, main .relative span, main .relative div');
  allSpansAndBtns.forEach((el) => {
    if (el.textContent && el.textContent.trim().toUpperCase() === 'REINTENTAR') {
      const parent = el.closest('button, div, span') || el;
      parent.style.setProperty('display', 'none', 'important');
      parent.remove();
    }
  });
}

function setupWidgetObserver() {
  const observer = new MutationObserver(() => {
    syncFromWidgetDOM();
    purgeRetryBadges();
  });

  const targets = [
    document.getElementById('sonic_title'),
    document.getElementById('sonic_art_full'),
    document.getElementById('sonic_art'),
    document.getElementById('sonic_listeners'),
    document.querySelector('.cc_streaminfo[data-type="song"]'),
    document.querySelector('.cc_streaminfo[data-type="trackimageurl"]')
  ].filter(Boolean);

  targets.forEach((el) => {
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });
  });

  setInterval(() => {
    syncFromWidgetDOM();
    purgeRetryBadges();
  }, 2500);

  setTimeout(purgeRetryBadges, 100);
  setTimeout(syncFromWidgetDOM, 300);
  setTimeout(purgeRetryBadges, 800);
  setTimeout(syncFromWidgetDOM, 1200);
}

function cleanString(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function isValidUrl(string) {
  try {
    const url = new URL(string, window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function updateMetadataUI(title, artist, art, listeners) {
  const hasTitleChanged = state.currentTitle !== title;
  const hasArtistChanged = state.currentArtist !== artist;
  const hasArtChanged = state.currentArt !== art;

  if (hasTitleChanged) {
    state.currentTitle = title;
    if (dom.trackTitle) dom.trackTitle.textContent = title;
    document.title = `${title} • MyRadio`;
  }

  if (hasArtistChanged) {
    state.currentArtist = artist;
    if (dom.trackArtist) dom.trackArtist.textContent = artist;
  }

  if (hasArtChanged && dom.artworkImg) {
    state.currentArt = art;
    dom.artworkImg.style.opacity = '0.4';
    dom.artworkImg.style.objectFit = 'cover';
    
    setTimeout(() => {
      dom.artworkImg.src = art;
      dom.artworkImg.onload = () => {
        dom.artworkImg.style.opacity = '1';
      };
      dom.artworkImg.onerror = () => {
        dom.artworkImg.src = CONFIG.DEFAULT_ARTWORK;
        dom.artworkImg.style.opacity = '1';
      };
    }, 150);
  }

  if (listeners !== null && listeners !== undefined && !isNaN(listeners)) {
    if (dom.listenersCount) dom.listenersCount.textContent = listeners;
    if (dom.listenersBadge) dom.listenersBadge.classList.remove('hidden');
  }

  if (hasTitleChanged || hasArtistChanged || hasArtChanged) {
    updateMediaSessionMetadata(title, artist, art);
  }
}

// ==========================================
// 7. MEDIASESSION API
// ==========================================
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.setActionHandler('play', playStream);
  navigator.mediaSession.setActionHandler('pause', pauseStream);
  navigator.mediaSession.setActionHandler('stop', () => stopStream(true));
  navigator.mediaSession.setActionHandler('previoustrack', refreshStream);
  navigator.mediaSession.setActionHandler('nexttrack', refreshStream);
}

function updateMediaSessionMetadata(title, artist, artUrl) {
  if (!('mediaSession' in navigator)) return;

  let artworkSrc = artUrl || CONFIG.DEFAULT_ARTWORK;
  try {
    artworkSrc = new URL(artworkSrc, window.location.href).href;
  } catch (e) {
    artworkSrc = CONFIG.DEFAULT_ARTWORK;
  }

  if (!artworkSrc.startsWith('http') && !artworkSrc.startsWith('data:') && !artworkSrc.startsWith('blob:')) {
    return;
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: title || CONFIG.DEFAULT_TITLE,
    artist: artist || CONFIG.DEFAULT_ARTIST,
    album: 'MyRadio - Transmisión en Vivo',
    artwork: [
      { src: artworkSrc, sizes: '512x512', type: 'image/png' }
    ]
  });
}

function updateMediaSessionPlayback(playbackState) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playbackState;
  }
}

// ==========================================
// 8. SLEEP TIMER
// ==========================================
function startSleepTimer(minutes) {
  clearInterval(state.timerIntervalId);

  const totalSeconds = minutes * 60;
  state.timerSecondsLeft = totalSeconds;

  updateTimerDisplay(totalSeconds);
  if (dom.timerBadge) dom.timerBadge.classList.remove('hidden');

  showToast(`Temporizador activado: ${minutes} min`, '⏰');
  closeTimerModalHandler();

  state.timerIntervalId = setInterval(() => {
    state.timerSecondsLeft -= 1;

    if (state.timerSecondsLeft <= 0) {
      clearInterval(state.timerIntervalId);
      state.timerIntervalId = null;
      state.timerSecondsLeft = null;

      stopStream(false);
      resetTimerUI();
      showToast('Temporizador finalizado. Audio apagado.', '🌙');
    } else {
      updateTimerDisplay(state.timerSecondsLeft);
    }
  }, 1000);
}

function cancelSleepTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
    state.timerSecondsLeft = null;
    resetTimerUI();
    showToast('Temporizador desactivado', 'ℹ️');
  }
  closeTimerModalHandler();
}

function updateTimerDisplay(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const formatted = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

  if (dom.modalCountdown) dom.modalCountdown.textContent = formatted;
  if (dom.timerBadgeText) dom.timerBadgeText.textContent = `${m}m`;
}

function resetTimerUI() {
  if (dom.modalCountdown) dom.modalCountdown.textContent = '--:--';
  if (dom.timerBadge) dom.timerBadge.classList.add('hidden');
}

function openTimerModalHandler() {
  if (!dom.timerModal) return;
  
  // Forzar visibilidad y puntero de forma directa
  dom.timerModal.style.display = 'flex';
  dom.timerModal.style.pointerEvents = 'auto';
  
  setTimeout(() => {
    dom.timerModal.classList.remove('opacity-0');
    dom.timerModal.classList.add('opacity-100');
    const innerCard = dom.timerModal.querySelector('div');
    if (innerCard) {
      innerCard.classList.remove('scale-95');
      innerCard.classList.add('scale-100');
    }
  }, 10);
}

function closeTimerModalHandler() {
  if (!dom.timerModal) return;
  
  dom.timerModal.classList.remove('opacity-100');
  dom.timerModal.classList.add('opacity-0');
  dom.timerModal.style.pointerEvents = 'none';
  
  const innerCard = dom.timerModal.querySelector('div');
  if (innerCard) {
    innerCard.classList.remove('scale-100');
    innerCard.classList.add('scale-95');
  }

  setTimeout(() => {
    dom.timerModal.style.display = 'none';
  }, 300);
}

// ==========================================
// 9. CONTROLES DE VOLUMEN
// ==========================================
function setupVolumeControls() {
  const savedVolume = localStorage.getItem('myradio_volume');
  if (savedVolume !== null && dom.audio) {
    const val = parseFloat(savedVolume);
    state.volume = isNaN(val) ? 1 : val;
    dom.audio.volume = state.volume;
    if (dom.volumeSlider) dom.volumeSlider.value = state.volume;
    updateVolumeUI(state.volume);
  }

  if (dom.volumeSlider) {
    dom.volumeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      state.volume = val;
      if (dom.audio) dom.audio.volume = val;
      state.isMuted = val === 0;
      updateVolumeUI(val);
      localStorage.setItem('myradio_volume', val.toString());
    });
  }

  if (dom.volumeBtn) {
    dom.volumeBtn.addEventListener('click', () => {
      if (!dom.audio) return;
      if (state.isMuted || dom.audio.volume === 0) {
        const restoreVol = state.volume > 0 ? state.volume : 0.8;
        dom.audio.volume = restoreVol;
        if (dom.volumeSlider) dom.volumeSlider.value = restoreVol;
        state.isMuted = false;
        updateVolumeUI(restoreVol);
      } else {
        dom.audio.volume = 0;
        if (dom.volumeSlider) dom.volumeSlider.value = 0;
        state.isMuted = true;
        updateVolumeUI(0);
      }
    });
  }
}

function updateVolumeUI(volumeVal) {
  if (!dom.volumePercent) return;
  const percent = Math.round(volumeVal * 100);
  dom.volumePercent.textContent = `${percent}%`;

  if (volumeVal === 0) {
    dom.volumeHighIcon?.classList.add('hidden');
    dom.volumeMuteIcon?.classList.remove('hidden');
  } else {
    dom.volumeHighIcon?.classList.remove('hidden');
    dom.volumeMuteIcon?.classList.add('hidden');
  }
}

// ==========================================
// 10. COMPONENTES VISUALES Y UI HELPERS
// ==========================================
function setLoadingState(loading) {
  state.isLoading = loading;
  if (loading) {
    dom.playIcon?.classList.add('hidden');
    dom.pauseIcon?.classList.add('hidden');
    dom.loadingSpinner?.classList.remove('hidden');
  } else {
    dom.loadingSpinner?.classList.add('hidden');
  }
}

function updatePlaybackUI(isPlaying) {
  if (isPlaying) {
    dom.playIcon?.classList.add('hidden');
    dom.pauseIcon?.classList.remove('hidden');
    dom.visualizerBars?.classList.remove('opacity-40');
    dom.visualizerBars?.classList.add('opacity-100');
    animateVisualizer(true);
  } else {
    dom.playIcon?.classList.remove('hidden');
    dom.pauseIcon?.classList.add('hidden');
    dom.visualizerBars?.classList.remove('opacity-100');
    dom.visualizerBars?.classList.add('opacity-40');
    animateVisualizer(false);
  }
}

function updateStatus(type, label) {
  if (!dom.statusText || !dom.liveDot) return;
  dom.statusText.textContent = label;
  dom.liveDot.className = 'w-2 h-2 rounded-full transition-all duration-300';

  if (type === 'error') {
    dom.liveDot.classList.add('bg-rose-500');
    dom.statusText.className = 'text-[11px] font-bold uppercase tracking-wider text-rose-400';
    dom.statusBadge?.classList.remove('hidden');
  } else {
    dom.statusBadge?.classList.add('hidden');
    if (type === 'live') {
      dom.liveDot.classList.add('bg-emerald-400', 'animate-pulse', 'shadow-[0_0_8px_#34d399]');
      dom.statusText.className = 'text-[11px] font-bold uppercase tracking-wider text-emerald-400';
    } else if (type === 'connecting') {
      dom.liveDot.classList.add('bg-amber-400', 'animate-ping');
      dom.statusText.className = 'text-[11px] font-bold uppercase tracking-wider text-amber-300';
    } else {
      dom.liveDot.classList.add('bg-slate-500');
      dom.statusText.className = 'text-[11px] font-bold uppercase tracking-wider text-slate-400';
    }
  }
}

function animateVisualizer(active) {
  if (!dom.visualizerBars) return;
  const bars = dom.visualizerBars.querySelectorAll('span');
  bars.forEach((bar, index) => {
    if (active) {
      bar.classList.add(`animate-eq-${(index % 5) + 1}`);
    } else {
      bar.className = 'w-1 bg-cyan-400 rounded-full h-1.5 transition-all duration-200';
    }
  });
}

let toastTimeout = null;
function showToast(message, icon = '✨', durationMs = 2500) {
  if (!dom.toast) return;

  if (dom.toastMessage) dom.toastMessage.textContent = message;
  if (dom.toastIcon) dom.toastIcon.textContent = icon;

  dom.toast.classList.remove('translate-y-24', 'opacity-0');
  dom.toast.classList.add('translate-y-0', 'opacity-100');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    dom.toast.classList.remove('translate-y-0', 'opacity-100');
    dom.toast.classList.add('translate-y-24', 'opacity-0');
  }, durationMs);
}

// ==========================================
// 11. COMPARTIR Y PWA
// ==========================================
function setupShareAndPWA() {
  async function copyUrlToClipboard() {
    const url = window.location.href;
    let copied = false;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch (err) {
        console.warn('Clipboard API falló:', err);
      }
    }

    if (!copied) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch (err) {
        console.warn('Fallback copy falló:', err);
      }
    }

    showToast('¡Enlace copiado al portapapeles!', '📋', 2500);
  }

  dom.shareBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    copyUrlToClipboard();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    dom.pwaInstallBtn?.classList.remove('hidden');
    dom.pwaInstallBtn?.classList.add('flex');
  });

  dom.pwaInstallBtn?.addEventListener('click', async () => {
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt();
    const { outcome } = await state.deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('¡Gracias por instalar MyRadio!', '🎉');
    }
    state.deferredPrompt = null;
    dom.pwaInstallBtn?.classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => {
    dom.pwaInstallBtn?.classList.add('hidden');
    state.deferredPrompt = null;
    showToast('MyRadio instalada correctamente', '📱');
  });

  window.addEventListener('offline', () => {
    dom.offlineBanner?.classList.remove('-translate-y-20');
    dom.offlineBanner?.classList.add('translate-y-0');
  });

  window.addEventListener('online', () => {
    dom.offlineBanner?.classList.remove('translate-y-0');
    dom.offlineBanner?.classList.add('-translate-y-20');
    showToast('Conexión reestablecida', '📶');
    if (state.isPlaying) {
      refreshStream();
    }
  });
}

// ==========================================
// 12. INICIALIZACIÓN GENERAL
// ==========================================
function initApp() {
  if (dom.currentYear) {
    dom.currentYear.textContent = new Date().getFullYear();
  }

  // Eventos principales
  dom.playBtn?.addEventListener('click', togglePlayPause);
  dom.stopBtn?.addEventListener('click', () => stopStream(true));
  dom.refreshBtn?.addEventListener('click', refreshStream);

  // Sleep Timer
  dom.timerBtn?.addEventListener('click', openTimerModalHandler);
  dom.closeTimerModal?.addEventListener('click', closeTimerModalHandler);
  dom.cancelTimerBtn?.addEventListener('click', cancelSleepTimer);
  
  dom.timerPresetBtns?.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mins = parseInt(btn.getAttribute('data-minutes'), 10);
      if (!isNaN(mins)) {
        startSleepTimer(mins);
      }
    });
  });

  // Cerrar modal al hacer clic en el fondo
  dom.timerModal?.addEventListener('click', (e) => {
    if (e.target === dom.timerModal) {
      closeTimerModalHandler();
    }
  });

  setupAudioEvents();
  setupVolumeControls();
  setupMediaSession();
  setupShareAndPWA();
  setupWidgetObserver();
  
  syncFromWidgetDOM();
}

// Inicializar al cargar el DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}