    /**
     * =========================================================================
     * SECTION 6: UNIFIED DATA MODELS (CHANNELS, MOVIES, SERIES)
     * =========================================================================
     */
    // Mode State: 'live' | 'movies' | 'series'
    let currentAppMode = 'live';

    // Live data is populated from the connected IPTV provider.
    const iptvLiveCategories = [];
    const iptvLiveChannels = [];
    const iptvVodCategories = [];
    const iptvVodMovies = [];
    const iptvSeriesCategories = [];
    const iptvSeries = [];

    const FAVORITES_STORAGE_KEY = 'sonix_favorites_v1';
    function loadSavedFavorites() {
      try {
        const saved = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]');
        return new Set(Array.isArray(saved) ? saved.filter(value => typeof value === 'string') : []);
      } catch (_) {
        return new Set();
      }
    }
    const memoryFavorites = loadSavedFavorites();
    function persistFavorites() {
      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(memoryFavorites)));
      } catch (error) {
        console.warn('Could not persist favorites:', error);
        showToast('تعذر حفظ المفضلة على هذا الجهاز');
      }
    }

    // =========================================================================
    // REAL XTREAM API DATA SOURCE
    // Requests run through the Android bridge to avoid WebView CORS restrictions.
    // =========================================================================
    const iptvState = { server: '', username: '', password: '', connected: false, userInfo: null };
    let seriesEpisodeMode = false;
    let currentSeriesParent = null;
    let currentSeriesEpisodes = [];
    let currentSeriesSeasonCategories = [];

    function replaceArray(target, values) {
      target.splice(0, target.length, ...values);
    }

    function normalizeServerUrl(value) {
      let valueToUse = String(value || '').trim();
      if (!valueToUse) throw new Error('أدخل رابط الخادم أولاً');
      if (!/^https?:\/\//i.test(valueToUse)) valueToUse = 'http://' + valueToUse;
      const parsed = new URL(valueToUse);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
        throw new Error('رابط الخادم غير صالح');
      }
      return parsed.origin + parsed.pathname.replace(/\/+$/, '');
    }

    function xtreamApiUrl(action, extra = {}) {
      const url = new URL(iptvState.server.replace(/\/+$/, '') + '/player_api.php');
      url.searchParams.set('username', iptvState.username);
      url.searchParams.set('password', iptvState.password);
      if (action) url.searchParams.set('action', action);
      Object.entries(extra).forEach(([key, value]) => url.searchParams.set(key, String(value)));
      return url.toString();
    }

    let iptvRequestCounter = 0;
    const pendingIptvRequests = new Map();

    window.__onIptvResponse = function(requestId, serializedResult) {
      const pending = pendingIptvRequests.get(String(requestId));
      if (!pending) return;
      pendingIptvRequests.delete(String(requestId));
      try {
        const result = JSON.parse(serializedResult);
        if (!result || !result.ok) {
          const status = result && result.status ? ' (' + result.status + ')' : '';
          pending.reject(new Error('فشل الاتصال بخادم الاشتراك' + status));
          return;
        }
        pending.resolve(JSON.parse(result.body));
      } catch (_) {
        pending.reject(new Error('تعذر قراءة استجابة خادم IPTV'));
      }
    };

    function nativeHttpGet(url) {
      return new Promise((resolve, reject) => {
        if (!window.AndroidBridge || typeof window.AndroidBridge.fetchIptv !== 'function') {
          reject(new Error('نسخة التطبيق لا تدعم الاتصال بمزود IPTV؛ حدّث التطبيق'));
          return;
        }
        const requestId = String(++iptvRequestCounter);
        pendingIptvRequests.set(requestId, { resolve, reject });
        try {
          window.AndroidBridge.fetchIptv(url, requestId);
        } catch (_) {
          pendingIptvRequests.delete(requestId);
          reject(new Error('تعذر بدء الاتصال بخادم IPTV'));
        }
      });
    }

    async function xtreamRequest(action, extra = {}) {
      return nativeHttpGet(xtreamApiUrl(action, extra));
    }

    function makeStreamUrl(type, streamId, extension) {
      const ext = extension || (type === 'live' ? 'm3u8' : 'mp4');
      const path = type === 'live' ? 'live' : (type === 'movie' ? 'movie' : 'series');
      return iptvState.server.replace(/\/+$/, '') + '/' + path + '/' +
        encodeURIComponent(iptvState.username) + '/' +
        encodeURIComponent(iptvState.password) + '/' +
        encodeURIComponent(streamId) + '.' + String(ext).replace(/^\./, '');
    }

    function mapXtreamCategories(rows, prefix, includeFavorites = false) {
      const mapped = (Array.isArray(rows) ? rows : [])
        .filter(row => row && row.category_id != null && String(row.category_name || '').trim())
        .map(row => ({
          id: prefix + String(row.category_id),
          sourceId: String(row.category_id),
          name: String(row.category_name).trim(),
          count: 0
        }));
      if (includeFavorites) mapped.push({ id: 'cat-fav', name: 'المفضلة', count: 0 });
      return mapped;
    }

    function mapXtreamItems(rows, prefix, type) {
      return (Array.isArray(rows) ? rows : [])
        .filter(row => row && (type === 'series' ? row.series_id != null : row.stream_id != null) && String(row.name || '').trim())
        .map(row => {
        const categoryId = row.category_id == null ? '' : String(row.category_id);
        const category = categoryId ? prefix + categoryId : prefix + '__uncategorized__';
        const categoryName = type === 'live'
          ? (iptvLiveCategories.find(c => c.id === category)?.name || 'غير مصنف')
          : (type === 'movie'
            ? (iptvVodCategories.find(c => c.id === category)?.name || 'غير مصنف')
            : (iptvSeriesCategories.find(c => c.id === category)?.name || 'غير مصنف'));
        const id = String(type === 'live' ? row.stream_id : (type === 'movie' ? row.stream_id : row.series_id));
        return {
          id: type + '-' + id,
          sourceId: id,
          number: row.num == null || row.num === '' ? '' : String(row.num),
          name: String(row.name).trim(),
          category,
          categoryName,
          logoText: '',
          logo: row.stream_icon || row.cover || '',
          streamUrl: type === 'series' ? '' : makeStreamUrl(type, id, row.container_extension || (type === 'live' ? 'ts' : 'mp4')),
          audioOnlyUrl: type === 'live' ? String(row.audio_only_url || row.audio_url || row.commentary_url || row.audio_track_url || '') : '',
          rating: row.rating || '',
          specs: row.container_extension ? String(row.container_extension).toUpperCase() : '',
          desc: row.plot || '',
          isSeries: type === 'series'
        };
      });
    }

    function ensureCatalogCategories(categories, items, prefix) {
      const known = new Set(categories.map(category => category.id));
      const needsUncategorized = items.some(item => !known.has(item.category));
      if (needsUncategorized) {
        const id = prefix + '__uncategorized__';
        if (!known.has(id)) {
          categories.push({ id, sourceId: '', name: 'غير مصنف', count: 0 });
          known.add(id);
        }
        items.forEach(item => {
          if (!known.has(item.category)) {
            item.category = id;
            item.categoryName = 'غير مصنف';
          }
        });
      }
      categories.forEach(category => {
        category.count = items.filter(item => item.category === category.id).length;
      });
    }

    function refreshCurrentContent() {
      const categories = getActiveCategoryList();
      const items = getActiveItemList();
      if (!categories.some(c => c.id === currentActiveCategory)) currentActiveCategory = categories[0]?.id || '';
      currentSelectedItem = items.find(item => item.category === currentActiveCategory) || items[0] || null;
      renderCategories();
      renderItems();
      renderAudioSourcePicker();
      if (currentSelectedItem && currentSelectedItem.streamUrl) videoPlaybackController.loadItem(currentSelectedItem);
      else if (videoPlaybackController) {
        videoPlaybackController.stopAndRelease();
        videoPlaybackController.showError('اختر قناة أو محتوى من اشتراكك لبدء التشغيل');
      }
    }

    function formatXtreamExpiry(value) {
      if (value == null || value === '' || String(value) === '0') return 'غير محدد';
      const numeric = Number(value);
      const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric * 1000) : new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return new Intl.DateTimeFormat('ar', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    }

    function renderProfile() {
      const info = iptvState.userInfo;
      const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
      };
      if (!info) {
        setText('profile-username', 'غير متصل');
        setText('profile-package', 'غير متاح');
        setText('profile-id', '—');
        setText('profile-expiry', 'غير متاح');
        setText('profile-status', 'لم يتم التحقق من الاشتراك');
        setText('home-username', 'غير متصل');
        setText('home-user-id', '—');
        setText('home-expiry', 'غير متاح');
        setText('home-live-count', 'القنوات غير محمّلة');
        setText('home-movies-count', 'الأفلام غير محمّلة');
        setText('home-series-count', 'المسلسلات غير محمّلة');
        return;
      }
      const accountName = String(info.username || '—');
      const expiry = formatXtreamExpiry(info.exp_date);
      setText('profile-username', accountName);
      setText('profile-package', info.is_trial == null ? 'غير محدد من الخادم' : (Number(info.is_trial) === 1 ? 'تجريبي' : 'غير تجريبي'));
      setText('profile-id', accountName);
      setText('profile-expiry', expiry);
      setText('profile-status', String(info.status || 'غير محددة من الخادم'));
      setText('home-username', accountName);
      setText('home-user-id', accountName);
      setText('home-expiry', expiry);
      setText('home-live-count', 'القنوات: ' + iptvLiveChannels.length);
      setText('home-movies-count', 'الأفلام: ' + iptvVodMovies.length);
      setText('home-series-count', 'المسلسلات: ' + iptvSeries.length);
    }

    async function connectAndLoadIptv(showStatus = true) {
      const button = document.getElementById('btn-save-iptv');
      const status = document.getElementById('iptv-connection-status');
      const server = normalizeServerUrl(document.getElementById('iptv-server-url').value);
      const username = document.getElementById('iptv-username').value.trim();
      const password = document.getElementById('iptv-password').value;
      if (!username || !password) throw new Error('أدخل اسم المستخدم وكلمة المرور');
      if (button) { button.disabled = true; button.textContent = 'جارٍ اختبار الاتصال وتحميل البيانات...'; }
      if (status) status.textContent = 'جارٍ الاتصال بالخادم...';

      const previousCredentials = {
        server: iptvState.server,
        username: iptvState.username,
        password: iptvState.password,
        connected: iptvState.connected,
        userInfo: iptvState.userInfo
      };
      iptvState.server = server;
      iptvState.username = username;
      iptvState.password = password;
      try {
        const auth = await xtreamRequest('');
        const userInfo = auth && auth.user_info;
        if (!userInfo || Number(userInfo.auth) !== 1 || String(userInfo.status || '').toLowerCase() === 'disabled') {
          throw new Error('بيانات الاشتراك غير صحيحة أو الاشتراك غير نشط');
        }

        // Save only after the provider has authenticated the credentials. A failed
        // optional catalog endpoint must not force the customer to log in again.
        if (window.AndroidBridge && typeof window.AndroidBridge.saveIptvConfig === 'function') {
          const saved = window.AndroidBridge.saveIptvConfig(server, username, password);
          if (!saved) throw new Error('تم التحقق من الاشتراك لكن تعذر حفظ بياناته بأمان');
        }

        const actions = [
          ['get_live_categories', 'liveCategories'],
          ['get_live_streams', 'liveStreams'],
          ['get_vod_categories', 'movieCategories'],
          ['get_vod_streams', 'movieStreams'],
          ['get_series_categories', 'seriesCategories'],
          ['get_series', 'seriesStreams']
        ];
        const results = await Promise.allSettled(actions.map(([action]) => xtreamRequest(action)));
        const loaded = {};
        const failedCatalogs = [];
        actions.forEach(([action, key], index) => {
          const result = results[index];
          if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            loaded[key] = result.value;
          } else {
            loaded[key] = [];
            failedCatalogs.push(action);
          }
        });

        replaceArray(iptvLiveCategories, mapXtreamCategories(loaded.liveCategories, 'live-', true));
        replaceArray(iptvVodCategories, mapXtreamCategories(loaded.movieCategories, 'movie-'));
        replaceArray(iptvSeriesCategories, mapXtreamCategories(loaded.seriesCategories, 'series-'));
        replaceArray(iptvLiveChannels, mapXtreamItems(loaded.liveStreams, 'live-', 'live'));
        replaceArray(iptvVodMovies, mapXtreamItems(loaded.movieStreams, 'movie-', 'movie'));
        replaceArray(iptvSeries, mapXtreamItems(loaded.seriesStreams, 'series-', 'series'));
        ensureCatalogCategories(iptvLiveCategories, iptvLiveChannels, 'live-');
        ensureCatalogCategories(iptvVodCategories, iptvVodMovies, 'movie-');
        ensureCatalogCategories(iptvSeriesCategories, iptvSeries, 'series-');

        iptvState.userInfo = userInfo;
        iptvState.connected = true;
        renderProfile();
        seriesEpisodeMode = false;
        currentSeriesParent = null;
        currentSeriesEpisodes = [];
        currentSeriesSeasonCategories = [];
        currentAppMode = 'live';
        currentActiveCategory = iptvLiveCategories.find(c => c.id !== 'cat-fav')?.id || 'cat-fav';
        refreshCurrentContent();

        const counts = 'القنوات: ' + iptvLiveChannels.length + ' | الأفلام: ' + iptvVodMovies.length + ' | المسلسلات: ' + iptvSeries.length;
        if (status) {
          status.textContent = 'تم تسجيل الدخول بنجاح — ' + counts +
            (failedCatalogs.length ? ' | تعذر تحميل بعض الأقسام: ' + failedCatalogs.join('، ') : '');
        }
        if (failedCatalogs.length) {
          showToast('تم تسجيل الدخول؛ بعض أقسام الاشتراك غير متاحة حالياً');
        }
        sessionAuthenticated = true;
        switchView('view-home');
        if (showStatus) showToast('مرحباً بك في SONIX TV');
        return true;
      } catch (error) {
        iptvState.server = previousCredentials.server;
        iptvState.username = previousCredentials.username;
        iptvState.password = previousCredentials.password;
        iptvState.connected = previousCredentials.connected;
        iptvState.userInfo = previousCredentials.userInfo;
        if (status) status.textContent = error.message || 'فشل الاتصال';
        throw error;
      } finally {
        if (button) { button.disabled = false; button.textContent = 'تسجيل الدخول'; }
      }
    }

    function exitSeriesEpisodeMode() {
      if (!seriesEpisodeMode) return false;
      const parent = currentSeriesParent;
      seriesEpisodeMode = false;
      currentSeriesEpisodes = [];
      currentSeriesSeasonCategories = [];
      currentSeriesParent = null;
      currentSelectedItem = parent || null;
      currentActiveCategory = parent?.category || iptvSeriesCategories[0]?.id || '';
      renderCategories();
      renderItems();
      if (videoPlaybackController) {
        videoPlaybackController.stopAndRelease();
        videoPlaybackController.showError('اختر حلقة من المسلسل لبدء التشغيل');
      }
      const category = iptvSeriesCategories.find(item => item.id === currentActiveCategory);
      const badge = document.getElementById('channels-badge-name');
      if (badge) badge.textContent = category?.name || 'المسلسلات';
      showToast('العودة إلى قائمة المسلسلات');
      return true;
    }

    async function loadSeriesEpisodes(series) {
      if (!series || !series.sourceId) return;
      showToast('جارٍ تحميل مواسم وحلقات ' + series.name);
      try {
        const info = await xtreamRequest('get_series_info', { series_id: series.sourceId });
        const seasons = info && info.episodes ? info.episodes : {};
        const seasonKeys = Object.keys(seasons).sort((a, b) => Number(a) - Number(b));
        const episodeItems = [];
        const seasonCategories = [];
        seasonKeys.forEach((season, seasonIndex) => {
          const entries = Array.isArray(seasons[season]) ? seasons[season] : [];
          const categoryId = 'season-' + season;
          seasonCategories.push({ id: categoryId, name: 'الموسم ' + season, count: entries.length });
          entries.forEach((episode, episodeIndex) => {
            const episodeId = String(episode.id || episode.stream_id || '');
            if (!episodeId) return;
            episodeItems.push({
              id: 'episode-' + episodeId,
              sourceId: episodeId,
              number: Number(episode.episode_num || episodeIndex + 1),
              name: 'S' + season + ' E' + (episode.episode_num || episodeIndex + 1) + ' — ' + String(episode.title || series.name),
              category: categoryId,
              categoryName: 'الموسم ' + season,
              logoText: 'E' + (episode.episode_num || episodeIndex + 1),
              logo: episode.info?.movie_image || series.logo || '',
              streamUrl: makeStreamUrl('series', episodeId, episode.container_extension),
              rating: episode.info?.rating || series.rating || '',
              specs: 'الموسم ' + season + ' • الحلقة ' + (episode.episode_num || episodeIndex + 1),
              desc: episode.info?.plot || series.desc || '',
              isEpisode: true
            });
          });
        });
        if (!episodeItems.length) throw new Error('لا توجد حلقات متاحة لهذا المسلسل في الخادم');
        currentSeriesParent = series;
        currentSelectedItem = series;
        currentSeriesEpisodes = episodeItems;
        currentSeriesSeasonCategories = seasonCategories;
        seriesEpisodeMode = true;
        currentActiveCategory = seasonCategories[0]?.id || '';
        document.getElementById('channels-badge-name').textContent = series.name;
        currentSelectedItem = null;
        renderCategories();
        renderItems();
        showToast('تم تحميل ' + episodeItems.length + ' حلقة');
      } catch (error) {
        showToast(error.message || 'تعذر تحميل حلقات المسلسل');
      }
    }

    /**
     * =========================================================================
     * SECTION 11 & 12: VIDEO ENGINE & DUAL AUDIO
     * =========================================================================
     */
    class VideoPlaybackController {
      constructor() {
        this.videoEl = document.getElementById('main-video');
        this.loaderEl = document.getElementById('player-loader');
        this.loaderText = document.getElementById('player-loader-text');
        this.errorEl = document.getElementById('player-error');
        this.currentItem = null;
        this.hlsInstance = null;
        this.retryAttempts = 0;
        this.maxRetries = 3;
        this.loadRequestId = 0;
        this.isFullscreen = false;
        this.epgRequestId = 0;
        this.bindEvents();
      }

      bindEvents() {
        this.videoEl.addEventListener('waiting', () => this.showLoader('جارٍ تخزين البث مؤقتاً...'));
        this.videoEl.addEventListener('playing', () => {
          this.hideLoader();
          if (window.AndroidBridge && window.AndroidBridge.setKeepScreenOn) window.AndroidBridge.setKeepScreenOn(true);
        });
        this.videoEl.addEventListener('pause', () => {
          if (window.AndroidBridge && window.AndroidBridge.setKeepScreenOn) window.AndroidBridge.setKeepScreenOn(false);
        });
        this.videoEl.addEventListener('ended', () => {
          if (window.AndroidBridge && window.AndroidBridge.setKeepScreenOn) window.AndroidBridge.setKeepScreenOn(false);
        });
        this.videoEl.addEventListener('canplay', () => this.hideLoader());
        this.videoEl.addEventListener('error', (e) => this.handleError(e));

        document.getElementById('player-retry-action').addEventListener('click', () => {
          if (this.currentItem) this.loadItem(this.currentItem);
        });

        document.getElementById('ctrl-play-pause').addEventListener('click', () => this.togglePlayPause());
        document.getElementById('ctrl-fullscreen-btn').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('ctrl-mute-btn').addEventListener('click', () => this.toggleMute());

        const exitBtn = document.getElementById('btn-exit-fullscreen');
        if (exitBtn) {
          exitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.exitFullscreen();
          });
        }

        // DOUBLE-CLICK & DOUBLE-TAP ON VIDEO VIEWPORT TO EXPAND / COLLAPSE FULLSCREEN
        const viewport = document.querySelector('.video-viewport');
        if (viewport) {
          viewport.addEventListener('dblclick', (e) => {
            e.preventDefault();
            this.toggleFullscreen();
          });

          let lastTapTime = 0;
          viewport.addEventListener('touchend', (e) => {
            if (e.target.closest('.control-btn') || e.target.closest('.action-btn') || e.target.closest('#btn-exit-fullscreen')) {
              return;
            }
            const now = Date.now();
            if (now - lastTapTime < 350 && now - lastTapTime > 40) {
              e.preventDefault();
              this.toggleFullscreen();
            }
            lastTapTime = now;
          });
        }
      }

      loadItem(item) {
        if (!item) return;
        const requestId = ++this.loadRequestId;
        this.currentItem = item;
        if (dualAudioEngine && dualAudioEngine.isActive) dualAudioEngine.stopExternalAudio(false);
        this.retryAttempts = 0;
        this.errorEl.classList.remove('active');
        this.showLoader(`جارٍ الاتصال بـ ${item.name}...`);

        if (this.hlsInstance) {
          this.hlsInstance.destroy();
          this.hlsInstance = null;
        }

        const streamUrl = item.streamUrl;
        if (!streamUrl) {
          this.showError('لا يوجد رابط تشغيل لهذا العنصر.');
          return;
        }
        const isM3u8 = streamUrl.toLowerCase().includes('.m3u8');

        if (isM3u8 && window.Hls && Hls.isSupported()) {
          this.hlsInstance = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 60
          });
          this.hlsInstance.loadSource(streamUrl);
          this.hlsInstance.attachMedia(this.videoEl);
          this.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            if (requestId !== this.loadRequestId) return;
            this.videoEl.play().catch(() => {});
          });
          this.hlsInstance.on(Hls.Events.ERROR, (event, data) => {
            if (requestId !== this.loadRequestId || !data.fatal) return;
            switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  this.retryOrFallback(streamUrl, requestId);
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  this.hlsInstance.recoverMediaError();
                  break;
                default:
                  this.hlsInstance.destroy();
                  this.hlsInstance = null;
                  this.showError('خطأ غير متوقع في محرك HLS.');
                  break;
            }
          });
        } else {
          this.videoEl.src = streamUrl;
          this.videoEl.play().catch((err) => {
            console.warn('Autoplay prevented or network delay', err);
          });
        }

        this.updateUiInfo(item);
      }

      retryOrFallback(url, requestId = this.loadRequestId) {
        if (requestId !== this.loadRequestId) return;
        if (this.retryAttempts < this.maxRetries) {
          this.retryAttempts++;
          this.showLoader(`إعادة محاولة الاتصال (${this.retryAttempts}/${this.maxRetries})...`);
          setTimeout(() => {
            if (requestId !== this.loadRequestId) return;
            if (this.hlsInstance) this.hlsInstance.startLoad();
            else if (this.currentItem) this.loadItem(this.currentItem);
          }, 1500);
        } else {
          this.showError('تعذر الاتصال بمصدر البث.');
        }
      }

      handleError(e) {
        console.error('Video error', e);
        this.showError('تعذر تشغيل هذا البث من مزود الخدمة. تحقق من صلاحية الرابط والاشتراك.');
      }

      showLoader(msg) {
        this.loaderText.textContent = msg || 'جارٍ التحميل...';
        this.loaderEl.classList.add('active');
      }

      hideLoader() {
        this.loaderEl.classList.remove('active');
        this.errorEl.classList.remove('active');
      }

      showError(msg) {
        this.loaderEl.classList.remove('active');
        const message = this.errorEl.querySelector('[data-error-message]');
        if (message) message.textContent = msg || 'تعذر تشغيل المحتوى';
        this.errorEl.classList.add('active');
      }

      togglePlayPause() {
        if (this.videoEl.paused) {
          this.videoEl.play();
          showToast('تم استئناف البث');
        } else {
          this.videoEl.pause();
          showToast('تم الإيقاف المؤقت');
        }
      }

      toggleMute() {
        if (dualAudioEngine && dualAudioEngine.isActive) {
          showToast('صوت الفيديو مكتوم تلقائياً لأن الصوت الخارجي نشط');
          return;
        }
        this.videoEl.muted = !this.videoEl.muted;
        showToast(this.videoEl.muted ? 'تم كتم الصوت' : 'تم تفعيل الصوت');
      }

      pause() {
        if (this.videoEl && !this.videoEl.paused) {
          this.videoEl.pause();
        }
      }

      toggleFullscreen() {
        const container = document.querySelector('.video-viewport');
        if (!container) return;
        this.isFullscreen = !this.isFullscreen;
        container.classList.toggle('is-fullscreen', this.isFullscreen);

        const exitBtn = document.getElementById('btn-exit-fullscreen');
        if (this.isFullscreen) {
          showToast('تم التكبير إلى ملء الشاشة (انقر مرتين أو اضغط زر الرجوع للتصغير)');
          if (exitBtn && remoteNavigator) {
            remoteNavigator.focusElement(exitBtn);
          }
        } else {
          showToast('تم الخروج من وضع ملء الشاشة');
        }
      }

      exitFullscreen() {
        if (this.isFullscreen) {
          this.toggleFullscreen();
          return true;
        }
        return false;
      }

      updateUiInfo(item) {
        document.getElementById('ticker-cat').textContent = item.categoryName;
        document.getElementById('ticker-ch').textContent = item.name;
        document.getElementById('player-ch-name').textContent = item.name;

        // VOD vs Live metadata display
        const vodMetaBox = document.getElementById('player-vod-meta-box');
        const primaryLabel = document.getElementById('primary-action-label');

        if (currentAppMode === 'live') {
          vodMetaBox.style.display = 'none';
          primaryLabel.textContent = 'دليل البرامج';
          document.getElementById('epg-modal-channel-name').textContent = `دليل البرامج - ${item.name}`;
          document.getElementById('epg-curr-title').textContent = 'لا تتوفر بيانات دليل البرامج من الخادم';
          document.getElementById('epg-curr-desc').textContent = 'لم يتم ربط خدمة EPG لهذا الاشتراك بعد.';
          document.getElementById('epg-next-title').textContent = 'جارٍ تحميل بيانات دليل البرامج...';
          this.loadEpgForChannel(item);
        } else {
          vodMetaBox.style.display = 'flex';
          document.getElementById('vod-rating-tag').textContent = item.rating ? `★ ${item.rating}/10` : 'التقييم غير متاح';
          document.getElementById('vod-specs-tag').textContent = item.specs ? 'الصيغة: ' + item.specs : 'صيغة الملف غير محددة من الخادم';
          document.getElementById('vod-cat-tag').textContent = item.categoryName;
          document.getElementById('vod-desc-text').textContent = item.desc || 'لا يوجد وصف متاح من مزود الاشتراك.';
          primaryLabel.textContent = currentAppMode === 'movies' ? 'تشغيل الفيلم' : 'تشغيل الحلقة';
        }

        updateFavoriteButtons(item.id);
      }

      async loadEpgForChannel(item) {
        const requestId = ++this.epgRequestId;
        const setText = (id, value) => {
          const element = document.getElementById(id);
          if (element) element.textContent = value;
        };
        const setProgress = value => {
          const bar = document.getElementById('epg-progress-percent');
          if (bar) bar.style.width = Math.max(0, Math.min(100, value)) + '%';
        };
        const noData = 'لا تتوفر بيانات دليل البرامج من الخادم';
        if (!item || !item.sourceId) {
          const currentBadge = document.getElementById('epg-current-badge');
          if (currentBadge) currentBadge.style.display = 'none';
          setText('epg-curr-title', noData);
          setText('epg-curr-time', '—');
          setText('epg-curr-desc', 'لم يقدم الخادم معلومات EPG لهذه القناة.');
          setText('epg-next-title', 'لا توجد بيانات للبرنامج التالي');
          setText('epg-next-time', '—');
          setProgress(0);
          return;
        }
        try {
          const response = await xtreamRequest('get_short_epg', { stream_id: item.sourceId, limit: 10 });
          if (requestId !== this.epgRequestId || !this.currentItem || this.currentItem.id !== item.id) return;
          const entries = Array.isArray(response) ? response :
            (Array.isArray(response?.epg_list) ? response.epg_list :
            (Array.isArray(response?.epg_listings) ? response.epg_listings : []));
          const toEpoch = value => {
            if (value == null || value === '') return NaN;
            const numeric = Number(value);
            if (Number.isFinite(numeric)) return numeric > 1000000000000 ? numeric / 1000 : numeric;
            const parsed = new Date(value).getTime();
            return Number.isNaN(parsed) ? NaN : parsed / 1000;
          };
          const events = entries.map(entry => ({
            entry,
            start: toEpoch(entry.start_timestamp || entry.start),
            end: toEpoch(entry.stop_timestamp || entry.end)
          })).filter(event => Number.isFinite(event.start) && Number.isFinite(event.end) && event.end > event.start)
            .sort((a, b) => a.start - b.start);
          const decodeText = value => {
            const raw = String(value || '');
            if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) return raw;
            try {
              const bytes = Uint8Array.from(atob(raw), character => character.charCodeAt(0));
              const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
              return decoded && !/[\u0000-\u0008]/.test(decoded) ? decoded : raw;
            } catch (_) {
              return raw;
            }
          };
          const now = Date.now() / 1000;
          const current = events.find(event => event.start <= now && event.end > now) || null;
          const next = events.find(event => event.start > now) || null;
          const clock = value => new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit' }).format(new Date(value * 1000));
          const currentBadge = document.getElementById('epg-current-badge');
          if (currentBadge) currentBadge.style.display = current ? 'inline-flex' : 'none';
          if (current) {
            setText('epg-curr-title', decodeText(current.entry.title || 'برنامج حالي'));
            setText('epg-curr-time', clock(current.start) + ' - ' + clock(current.end));
            setText('epg-curr-desc', decodeText(current.entry.description || 'لا يوجد وصف لهذا البرنامج.'));
            setProgress(((now - current.start) / (current.end - current.start)) * 100);
          } else {
            setText('epg-curr-title', noData);
            setText('epg-curr-time', '—');
            setText('epg-curr-desc', 'لا يوجد برنامج حالي ضمن بيانات EPG التي أعادها الخادم.');
            setProgress(0);
          }
          setText('epg-next-title', next ? decodeText(next.entry.title || 'البرنامج التالي') : 'لا توجد بيانات للبرنامج التالي');
          setText('epg-next-time', next ? clock(next.start) + ' - ' + clock(next.end) : '—');
        } catch (error) {
          if (requestId !== this.epgRequestId) return;
          const currentBadge = document.getElementById('epg-current-badge');
          if (currentBadge) currentBadge.style.display = 'none';
          setText('epg-curr-title', noData);
          setText('epg-curr-time', '—');
          setText('epg-curr-desc', 'تعذر تحميل EPG: ' + (error.message || 'خطأ غير معروف'));
          setText('epg-next-title', 'لا توجد بيانات للبرنامج التالي');
          setText('epg-next-time', '—');
          setProgress(0);
        }
      }

      stopAndRelease() {
        this.loadRequestId++;
        if (this.hlsInstance) {
          this.hlsInstance.destroy();
          this.hlsInstance = null;
        }
        this.videoEl.pause();
        this.videoEl.removeAttribute('src');
        this.videoEl.load();
      }
    }

    /**
     * =========================================================================
     * SECTION 12: DUAL AUDIO SYSTEM
     * =========================================================================
     */
    class DualAudioSystem {
      constructor(videoController) {
        this.videoController = videoController;
        this.audioEl = document.getElementById('external-audio');
        this.selectedSourceChannel = null;
        this.isActive = false;
        this.originalVideoMuted = false;
        this.audioContext = null;
        this.delayNode = null;
        this.sourceNode = null;
        this.delayMs = 0;
        this.hlsAudioInstance = null;
        this.audioRequestId = 0;
        this.statusTextEl = document.getElementById('ext-audio-status-text');
        this.statusPillEl = document.getElementById('ext-audio-status-pill');
        this.delayLabelEl = document.getElementById('delay-value-label');
        this.activeBadgeEl = document.getElementById('ext-audio-badge');
        this.btnExtAudioText = document.getElementById('ext-audio-btn-text');
        this.btnExtAudio = document.getElementById('btn-open-ext-audio');
        this.sourceNameEl = document.getElementById('selected-audio-source-name');

        this.initWebAudioGraph();
        this.bindEvents();
      }

      initWebAudioGraph() {
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            this.audioContext = new AudioContextClass();
            this.sourceNode = this.audioContext.createMediaElementSource(this.audioEl);
            this.delayNode = this.audioContext.createDelay(10.0);
            this.delayNode.delayTime.value = 0.0;
            this.sourceNode.connect(this.delayNode);
            this.delayNode.connect(this.audioContext.destination);
          }
        } catch (err) {
          console.warn('Web Audio API initialized on first touch', err);
        }
      }

      ensureAudioContextActive() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume();
        }
      }

      bindEvents() {
        document.getElementById('btn-start-audio').addEventListener('click', () => this.startExternalAudio());
        document.getElementById('btn-stop-audio').addEventListener('click', () => this.stopExternalAudio());

        document.getElementById('delay-plus-100').addEventListener('click', () => this.adjustDelay(100));
        document.getElementById('delay-minus-100').addEventListener('click', () => this.adjustDelay(-100));
        document.getElementById('delay-plus-500').addEventListener('click', () => this.adjustDelay(500));
        document.getElementById('delay-minus-500').addEventListener('click', () => this.adjustDelay(-500));
        document.getElementById('delay-reset').addEventListener('click', () => this.resetDelay());

        this.audioEl.addEventListener('playing', () => {
          this.isActive = true;
          this.activeBadgeEl.classList.add('visible');
          this.btnExtAudio.classList.add('is-active');
          this.btnExtAudioText.textContent = `صوت: ${this.selectedSourceChannel ? this.selectedSourceChannel.name.split(' ')[0] : 'خارجي'}`;
          this.setStatus('playing', 'يعمل');
          showToast('تم تشغيل الصوت الخارجي بنجاح وكتم صوت الفيديو الأصلي');
        });
        this.audioEl.addEventListener('error', () => this.handleAudioFailure());
      }

      setSourceChannel(channel) {
        if (!channel) return;
        this.selectedSourceChannel = channel;
        this.sourceNameEl.textContent = `${channel.name} (${channel.categoryName})`;
        document.querySelectorAll('.audio-picker-item').forEach(el => {
          el.classList.toggle('active', el.dataset.channelId === channel.id);
        });
        showToast(`تم اختيار ${channel.name} كمصدر للصوت`);

        if (this.isActive) {
          this.startExternalAudio();
        }
      }

      startExternalAudio() {
        if (!this.selectedSourceChannel) {
          showToast('يرجى اختيار قناة من القائمة كمصدر للصوت أولاً');
          return;
        }

        if (!this.isActive) this.originalVideoMuted = this.videoController.videoEl.muted;

        // An independent commentary/audio URL is required. Never treat the video
        // stream itself as a separate audio source.
        const audioUrl = typeof this.selectedSourceChannel.audioOnlyUrl === 'string'
          ? this.selectedSourceChannel.audioOnlyUrl.trim()
          : '';
        if (!audioUrl) {
          this.stopExternalAudio(false);
          this.setStatus('unavailable', 'لا يوجد صوت منفصل');
          showToast('هذه القناة لا تحتوي على رابط صوت مستقل للتعليق');
          return;
        }

        const requestId = ++this.audioRequestId;
        this.isActive = false;
        this.activeBadgeEl.classList.remove('visible');
        this.btnExtAudio.classList.remove('is-active');
        this.ensureAudioContextActive();
        this.setStatus('connecting', 'جارٍ الاتصال...');

        if (this.hlsAudioInstance) {
          this.hlsAudioInstance.destroy();
          this.hlsAudioInstance = null;
        }
        this.audioEl.pause();
        this.audioEl.removeAttribute('src');
        this.audioEl.load();

        this.videoController.videoEl.muted = true;

        const isM3u8 = audioUrl.toLowerCase().includes('.m3u8');
        if (isM3u8 && window.Hls && Hls.isSupported()) {
          this.hlsAudioInstance = new Hls({ lowLatencyMode: true });
          this.hlsAudioInstance.loadSource(audioUrl);
          this.hlsAudioInstance.attachMedia(this.audioEl);
          this.hlsAudioInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            if (requestId !== this.audioRequestId) return;
            this.audioEl.play().catch(() => this.handleAudioFailure(requestId));
          });
          this.hlsAudioInstance.on(Hls.Events.ERROR, (event, data) => {
            if (requestId === this.audioRequestId && data && data.fatal) this.handleAudioFailure(requestId);
          });
        } else {
          this.audioEl.src = audioUrl;
          this.audioEl.load();
          this.audioEl.play().catch(() => this.handleAudioFailure(requestId));
        }

        // Active state is set only after the audio element actually starts playing.
      }

      handleAudioFailure(requestId = this.audioRequestId) {
        if (requestId !== this.audioRequestId) return;
        if (this.hlsAudioInstance) {
          this.hlsAudioInstance.destroy();
          this.hlsAudioInstance = null;
        }
        this.audioEl.pause();
        this.audioEl.removeAttribute('src');
        this.audioEl.load();
        this.isActive = false;
        this.restoreOriginalVideoAudio();
        this.activeBadgeEl.classList.remove('visible');
        this.btnExtAudio.classList.remove('is-active');
        this.btnExtAudioText.textContent = 'الصوت الخارجي';
        this.setStatus('failed', 'فشل الاتصال');
        showToast('فشل اتصال الصوت الخارجي - تمت استعادة صوت الفيديو الأصلي');
      }

      stopExternalAudio(showMessage = true) {
        this.audioRequestId++;
        if (this.hlsAudioInstance) {
          this.hlsAudioInstance.destroy();
          this.hlsAudioInstance = null;
        }
        this.audioEl.pause();
        this.audioEl.removeAttribute('src');
        this.audioEl.load();
        this.isActive = false;

        this.setStatus('stopped', 'متوقف');
        this.restoreOriginalVideoAudio();
        this.activeBadgeEl.classList.remove('visible');
        this.btnExtAudio.classList.remove('is-active');
        this.btnExtAudioText.textContent = 'الصوت الخارجي';
        if (showMessage) {
          showToast('تم إيقاف الصوت الخارجي واستعادة صوت الفيديو الأصلي');
        }
      }

      restoreOriginalVideoAudio() {
        this.videoController.videoEl.muted = this.originalVideoMuted;
      }

      adjustDelay(deltaMs) {
        this.delayMs += deltaMs;
        if (this.delayMs < 0) this.delayMs = 0;
        if (this.delayMs > 8000) this.delayMs = 8000;

        const delaySeconds = this.delayMs / 1000.0;
        if (this.delayNode && this.audioContext) {
          this.delayNode.delayTime.setValueAtTime(delaySeconds, this.audioContext.currentTime);
        }

        this.delayLabelEl.textContent = `+${this.delayMs} ms`;
        showToast(`تم ضبط تأخير الصوت إلى ${this.delayMs} مللي ثانية`);
      }

      resetDelay() {
        this.delayMs = 0;
        if (this.delayNode && this.audioContext) {
          this.delayNode.delayTime.setValueAtTime(0, this.audioContext.currentTime);
        }
        this.delayLabelEl.textContent = '+0 ms';
        showToast('تمت إعادة تأخير الصوت إلى 0ms');
      }

      setStatus(type, label) {
        this.statusPillEl.className = `audio-status-pill status-${type}`;
        this.statusTextEl.textContent = label;
      }

      releaseAll() {
        this.stopExternalAudio();
        if (this.audioContext && this.audioContext.state !== 'closed') {
          this.audioContext.close().catch(() => {});
        }
      }
    }

    /**
     * =========================================================================
     * SECTION 8: D-PAD & TV REMOTE SPATIAL NAVIGATION SYSTEM
     * =========================================================================
     */
    class RemoteControlNavigator {
      constructor() {
        this.currentFocusedElement = null;
        window.remoteNavigator = this; // Expose on window for Android key forwarding
        this.bindKeyEvents();
      }

      bindKeyEvents() {
        window.addEventListener('keydown', (e) => {
          const activeModal = document.querySelector('.modal-backdrop.active');
          if (activeModal) {
            this.handleModalKey(e, activeModal);
            return;
          }

          switch (e.key) {
            case 'ArrowUp':
            case 'Up':
              e.preventDefault();
              this.navigateSpatial('up');
              break;
            case 'ArrowDown':
            case 'Down':
              e.preventDefault();
              this.navigateSpatial('down');
              break;
            case 'ArrowLeft':
            case 'Left':
              e.preventDefault();
              this.navigateSpatial('left');
              break;
            case 'ArrowRight':
            case 'Right':
              e.preventDefault();
              this.navigateSpatial('right');
              break;
            case 'Enter':
              if (this.currentFocusedElement) {
                this.currentFocusedElement.click();
              }
              break;
            case 'Escape':
            case 'Back':
            case 'Backspace':
              e.preventDefault();
              this.handleBackAction();
              break;
          }
        });
      }

      handleModalKey(e, modal) {
        if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Back') {
          e.preventDefault();
          closeAllModals();
          return;
        }

        const focusables = Array.from(modal.querySelectorAll('.focusable:not([disabled])'));
        if (!focusables.length) return;

        let currentIndex = focusables.indexOf(document.activeElement);
        if (currentIndex === -1) currentIndex = 0;

        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const nextIndex = (currentIndex + 1) % focusables.length;
          this.focusElement(focusables[nextIndex]);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault();
          const prevIndex = (currentIndex - 1 + focusables.length) % focusables.length;
          this.focusElement(focusables[prevIndex]);
        }
      }

      handleBackAction() {
        // 1. If currently in Fullscreen video mode, exit fullscreen first!
        if (videoPlaybackController && videoPlaybackController.isFullscreen) {
          videoPlaybackController.exitFullscreen();
          return;
        }

        // 2. If any modal is active, close it!
        const activeModal = document.querySelector('.modal-backdrop.active');
        if (activeModal) {
          closeAllModals();
          return;
        }

        // 3. Return from a series episode list to its parent series list first.
        if (exitSeriesEpisodeMode()) return;

        // 4. If in Live/Movies/Series content browser, return to Home screen!
        const currentActiveView = document.querySelector('.view-screen.active');
        if (!sessionAuthenticated) return;
        if (currentActiveView && currentActiveView.id !== 'view-home') {
          switchView('view-home');
          showToast('العودة إلى الشاشة الرئيسية');
        } else {
          openModal('modal-power');
        }
      }

      navigateSpatial(direction) {
        const visibleFocusables = Array.from(document.querySelectorAll('.view-screen.active .focusable:not([disabled])'));
        if (!visibleFocusables.length) return;

        if (!this.currentFocusedElement || !visibleFocusables.includes(this.currentFocusedElement)) {
          this.focusElement(visibleFocusables[0]);
          return;
        }

        const currentRect = this.currentFocusedElement.getBoundingClientRect();
        let bestTarget = null;
        let minDistance = Infinity;

        visibleFocusables.forEach(target => {
          if (target === this.currentFocusedElement) return;
          const rect = target.getBoundingClientRect();

          let isCandidate = false;
          let primaryDist = 0;
          let secondaryDist = 0;

          if (direction === 'up' && rect.bottom <= currentRect.top + 8) {
            isCandidate = true;
            primaryDist = currentRect.top - rect.bottom;
            secondaryDist = Math.abs((rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2));
          } else if (direction === 'down' && rect.top >= currentRect.bottom - 8) {
            isCandidate = true;
            primaryDist = rect.top - currentRect.bottom;
            secondaryDist = Math.abs((rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2));
          } else if (direction === 'left' && rect.right <= currentRect.left + 8) {
            isCandidate = true;
            primaryDist = currentRect.left - rect.right;
            secondaryDist = Math.abs((rect.top + rect.height / 2) - (currentRect.top + currentRect.height / 2));
          } else if (direction === 'right' && rect.left >= currentRect.right - 8) {
            isCandidate = true;
            primaryDist = rect.left - currentRect.right;
            secondaryDist = Math.abs((rect.top + rect.height / 2) - (currentRect.top + currentRect.height / 2));
          }

          if (isCandidate) {
            const distance = primaryDist * 1.0 + secondaryDist * 1.5;
            if (distance < minDistance) {
              minDistance = distance;
              bestTarget = target;
            }
          }
        });

        if (bestTarget) {
          this.focusElement(bestTarget);
        }
      }

      focusElement(element) {
        if (!element) return;
        if (this.currentFocusedElement) {
          this.currentFocusedElement.classList.remove('keyboard-focused');
        }
        this.currentFocusedElement = element;
        element.classList.add('keyboard-focused');
        try {
          element.focus({ preventScroll: true });
          if (typeof element.scrollIntoView === 'function') {
            element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
        } catch (err) {
          console.warn('focusElement non-critical error', err);
        }
      }
    }

    // Expose global back handler for Android MainActivity
    window.handleAndroidBack = function() {
      if (window.remoteNavigator) {
        window.remoteNavigator.handleBackAction();
      } else {
        switchView('view-home');
      }
    };

    // Global reset to home screen whenever app is resumed
    window.ensureHomeScreen = function() {
      closeAllModals();
      if (videoPlaybackController && videoPlaybackController.isFullscreen) {
        videoPlaybackController.exitFullscreen();
      }
      if (sessionAuthenticated) switchView('view-home');
      else switchView('view-login');
    };

    /**
     * =========================================================================
     * SECTION 1: ARABIC-INDIC CLOCK FORMATTER
     * =========================================================================
     */
    function toArabicIndicDigits(str) {
      const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
      return String(str).replace(/[0-9]/g, w => arabicDigits[+w]);
    }

    function updateLiveClock() {
      const now = new Date();
      let hours = now.getHours();
      const minutes = now.getMinutes();
      const isPm = hours >= 12;
      hours = hours % 12;
      hours = hours ? hours : 12;

      const formattedHours = hours < 10 ? '0' + hours : hours;
      const formattedMins = minutes < 10 ? '0' + minutes : minutes;
      const ampm = isPm ? 'م' : 'ص';

      const timeText = `${toArabicIndicDigits(formattedHours)}:${toArabicIndicDigits(formattedMins)} ${ampm}`;
      const clockDigitsEl = document.getElementById('home-clock-digits');
      if (clockDigitsEl) clockDigitsEl.textContent = timeText;

      const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      const dayName = days[now.getDay()];
      const monthName = months[now.getMonth()];
      const dayNum = toArabicIndicDigits(now.getDate());

      const clockDateEl = document.getElementById('home-clock-date');
      if (clockDateEl) clockDateEl.textContent = `${dayName}، ${dayNum} ${monthName}`;
    }

    /**
     * =========================================================================
     * SECTION 3 & 5: VIEW SWITCHING & APP MODES (LIVE, MOVIES, SERIES)
     * =========================================================================
     */
    let sessionAuthenticated = false;

    function switchView(viewId) {
      if (viewId !== 'view-login' && !sessionAuthenticated) viewId = 'view-login';
      if (viewId === 'view-home') {
        if (videoPlaybackController) {
          if (videoPlaybackController.isFullscreen) {
            videoPlaybackController.exitFullscreen();
          }
          videoPlaybackController.pause();
        }
        if (dualAudioEngine && dualAudioEngine.audioEl) {
          dualAudioEngine.stopExternalAudio(false);
        }
      }

      document.querySelectorAll('.view-screen').forEach(el => el.classList.remove('active'));
      const target = document.getElementById(viewId);
      if (target) {
        target.classList.add('active');

        let elementToFocus = null;
        if (viewId === 'view-login') {
          elementToFocus = document.getElementById('iptv-server-url');
        } else if (viewId === 'view-home') {
          elementToFocus = document.getElementById('card-channels');
        } else if (viewId === 'view-live') {
          elementToFocus = target.querySelector('.category-item.selected') || document.getElementById('live-btn-back');
        }
        if (!elementToFocus) {
          elementToFocus = target.querySelector('.focusable');
        }
        if (elementToFocus && remoteNavigator) {
          remoteNavigator.focusElement(elementToFocus);
        }
      }
    }

    function openModal(modalId) {
      closeAllModals();
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.add('active');
        const firstFocusable = modal.querySelector('.focusable');
        if (firstFocusable && remoteNavigator) {
          remoteNavigator.focusElement(firstFocusable);
        }
      }
    }

    function closeAllModals() {
      document.querySelectorAll('.modal-backdrop').forEach(el => el.classList.remove('active'));
    }

    let toastTimer = null;
    function showToast(message) {
      const toast = document.getElementById('toast-msg');
      const text = document.getElementById('toast-text');
      if (!toast || !text) return;

      text.textContent = message;
      toast.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove('show');
      }, 2500);
    }

    /**
     * =========================================================================
     * UNIFIED CONTENT BROWSER ENGINE (CHANNELS, MOVIES, SERIES IN SAME 4 COLUMNS)
     * =========================================================================
     */
    let currentActiveCategory = '';
    let currentSelectedItem = iptvLiveChannels[0];

    function setAppMode(mode) {
      currentAppMode = mode;
      
      // Update sidebar nav highlights
      document.getElementById('side-nav-live').classList.toggle('active', mode === 'live');
      document.getElementById('side-nav-movies').classList.toggle('active', mode === 'movies');
      document.getElementById('side-nav-series').classList.toggle('active', mode === 'series');

      // Update top bar title and placeholders
      const titleEl = document.getElementById('content-mode-title');
      const searchInput = document.getElementById('live-channel-search');
      const catSearchInput = document.getElementById('cat-filter-input');

      seriesEpisodeMode = false;
      currentSeriesParent = null;
      currentSeriesEpisodes = [];
      currentSeriesSeasonCategories = [];
      if (mode === 'live') {
        titleEl.textContent = 'مباشر';
        searchInput.placeholder = 'البحث في القنوات...';
        catSearchInput.placeholder = 'البحث في فئات القنوات...';
        currentActiveCategory = iptvLiveCategories.find(c => c.id !== 'cat-fav')?.id || 'cat-fav';
      } else if (mode === 'movies') {
        titleEl.textContent = 'الأفلام (VOD)';
        searchInput.placeholder = 'البحث في الأفلام...';
        catSearchInput.placeholder = 'البحث في تصنيفات الأفلام...';
        currentActiveCategory = iptvVodCategories[0]?.id || '';
      } else if (mode === 'series') {
        titleEl.textContent = 'المسلسلات (Series)';
        searchInput.placeholder = 'البحث في المسلسلات...';
        catSearchInput.placeholder = 'البحث في تصنيفات المسلسلات...';
        currentActiveCategory = iptvSeriesCategories[0]?.id || '';
      }

      currentSelectedItem = getActiveItemList().find(item => item.category === currentActiveCategory) || getActiveItemList()[0] || null;
      renderCategories();
      renderItems();
      if (currentSelectedItem && currentSelectedItem.streamUrl) videoPlaybackController.loadItem(currentSelectedItem);
      else videoPlaybackController.showError('لا توجد بيانات. أضف اشتراك IPTV من الإعدادات.');
    }

    function getActiveCategoryList() {
      if (currentAppMode === 'movies') return iptvVodCategories;
      if (currentAppMode === 'series') return seriesEpisodeMode ? currentSeriesSeasonCategories : iptvSeriesCategories;
      return iptvLiveCategories;
    }

    function getActiveItemList() {
      if (currentAppMode === 'movies') return iptvVodMovies;
      if (currentAppMode === 'series') return seriesEpisodeMode ? currentSeriesEpisodes : iptvSeries;
      return iptvLiveChannels;
    }

    function renderCategories() {
      const container = document.getElementById('categories-list-container');
      if (!container) return;
      container.innerHTML = '';

      const categories = getActiveCategoryList();
      const allItems = getActiveItemList();

      categories.forEach(cat => {
        const item = document.createElement('div');
        item.className = `category-item focusable ${cat.id === currentActiveCategory ? 'selected' : ''}`;
        item.tabIndex = 0;
        item.dataset.catId = cat.id;

        const count = cat.id === 'cat-fav' 
          ? memoryFavorites.size 
          : allItems.filter(c => c.category === cat.id).length;

        const name = document.createElement('span');
        name.textContent = cat.name;
        const badge = document.createElement('span');
        badge.className = 'category-badge';
        badge.textContent = String(count);
        item.append(name, badge);

        item.addEventListener('click', () => {
          selectCategory(cat.id);
        });

        container.appendChild(item);
      });
    }

    function selectCategory(catId) {
      currentActiveCategory = catId;
      document.querySelectorAll('.category-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.catId === catId);
      });

      const categories = getActiveCategoryList();
      const catObj = categories.find(c => c.id === catId);
      if (catObj) {
        document.getElementById('channels-badge-name').textContent = catObj.name;
      }

      renderItems();
    }

    function renderItems(filterText = '') {
      const container = document.getElementById('channels-list-container');
      if (!container) return;
      container.innerHTML = '';

      const allItems = getActiveItemList();
      let items = [];

      if (currentActiveCategory === 'cat-fav') {
        items = allItems.filter(c => memoryFavorites.has(c.id));
      } else {
        items = allItems.filter(c => c.category === currentActiveCategory);
      }

      if (filterText) {
        items = items.filter(c => c.name.toLowerCase().includes(filterText.toLowerCase()));
      }

      const countSuffix = currentAppMode === 'movies' ? 'فيلم' : (currentAppMode === 'series' ? 'مسلسل' : 'قناة');
      document.getElementById('channels-badge-count').textContent = `${items.length} ${countSuffix}`;

      if (items.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:24px; font-size:0.85rem;">لا توجد عناصر متاحة في هذا التصنيف</div>`;
        return;
      }

      items.forEach(it => {
        const row = document.createElement('div');
        const isSelected = currentSelectedItem && currentSelectedItem.id === it.id;
        const isFav = memoryFavorites.has(it.id);

        row.className = `channel-row focusable ${isSelected ? 'selected' : ''}`;
        row.tabIndex = 0;
        row.dataset.itemId = it.id;

        const number = document.createElement('span');
        number.className = 'channel-number';
        number.textContent = String(it.number || '');
        const logoBox = document.createElement('div');
        logoBox.className = 'channel-logo-box';
        const logoUrl = String(it.logo || '');
        if (/^https?:\/\//i.test(logoUrl)) {
          const image = document.createElement('img');
          image.alt = '';
          image.loading = 'lazy';
          image.referrerPolicy = 'no-referrer';
          image.src = logoUrl;
          image.onerror = () => { image.remove(); logoBox.textContent = String(it.logoText || 'TV'); };
          logoBox.appendChild(image);
        } else {
          logoBox.textContent = String(it.logoText || 'TV');
        }
        const name = document.createElement('span');
        name.className = 'channel-name';
        name.textContent = it.name;
        const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        star.setAttribute('class', 'channel-fav-star' + (isFav ? ' active' : ''));
        star.setAttribute('viewBox', '0 0 24 24');
        star.setAttribute('fill', 'currentColor');
        const starPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        starPath.setAttribute('d', 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z');
        star.appendChild(starPath);
        row.append(number, logoBox, name, star);

        let lastRowTap = 0;
        row.addEventListener('click', () => {
          selectItem(it);
        });

        // Double-click to play and expand to full screen immediately
        row.addEventListener('dblclick', (e) => {
          e.preventDefault();
          selectItem(it);
          if (videoPlaybackController && !videoPlaybackController.isFullscreen) {
            videoPlaybackController.toggleFullscreen();
          }
        });

        // Double-tap on touch screens
        row.addEventListener('touchend', (e) => {
          const now = Date.now();
          if (now - lastRowTap < 350 && now - lastRowTap > 40) {
            e.preventDefault();
            selectItem(it);
            if (videoPlaybackController && !videoPlaybackController.isFullscreen) {
              videoPlaybackController.toggleFullscreen();
            }
          }
          lastRowTap = now;
        });

        container.appendChild(row);
      });
    }

    function selectItem(item) {
      if (currentAppMode === 'series' && item && item.isSeries) {
        loadSeriesEpisodes(item);
        return;
      }
      currentSelectedItem = item;
      document.querySelectorAll('.channel-row').forEach(el => {
        el.classList.toggle('selected', el.dataset.itemId === item.id);
      });

      videoPlaybackController.loadItem(item);
      showToast(`تم الاختيار: ${item.name}`);
    }

    function renderAudioSourcePicker(filterText = '') {
      const container = document.getElementById('audio-channels-list');
      if (!container) return;
      container.innerHTML = '';

      let list = iptvLiveChannels;
      if (filterText) {
        list = list.filter(c => c.name.toLowerCase().includes(filterText.toLowerCase()));
      }

      list.forEach(ch => {
        const item = document.createElement('div');
        const isCurrentAudio = dualAudioEngine && dualAudioEngine.selectedSourceChannel && dualAudioEngine.selectedSourceChannel.id === ch.id;
        item.className = `audio-picker-item focusable ${isCurrentAudio ? 'active' : ''}`;
        item.tabIndex = 0;
        item.dataset.channelId = ch.id;
        const title = document.createElement('span');
        title.textContent = String(ch.number) + '. ' + ch.name;
        const category = document.createElement('span');
        category.style.fontSize = '0.7rem';
        category.style.color = 'var(--text-muted)';
        category.textContent = ch.categoryName;
        item.append(title, category);
        item.addEventListener('click', () => {
          dualAudioEngine.setSourceChannel(ch);
        });
        container.appendChild(item);
      });
    }

    function updateFavoriteButtons(itemId) {
      const isFav = memoryFavorites.has(itemId);
      const heartBtn = document.getElementById('player-heart-btn');
      const favLabel = document.getElementById('fav-btn-label');
      if (heartBtn) heartBtn.classList.toggle('active', isFav);
      if (favLabel) favLabel.textContent = isFav ? 'في المفضلة' : 'إضافة للمفضلة';
    }

    function toggleFavorite(itemId) {
      if (!itemId) return;
      if (memoryFavorites.has(itemId)) {
        memoryFavorites.delete(itemId);
        showToast('تمت الإزالة من المفضلة');
      } else {
        memoryFavorites.add(itemId);
        showToast('تمت الإضافة إلى المفضلة');
      }
      persistFavorites();
      updateFavoriteButtons(itemId);
      renderCategories();
      renderItems();
    }

    /**
     * =========================================================================
     * INITIALIZATION & LIFECYCLE
     * =========================================================================
     */
    let videoPlaybackController;
    let dualAudioEngine;
    let remoteNavigator;

    document.addEventListener('DOMContentLoaded', () => {
      // 1. Initialize Video & Audio Engines
      videoPlaybackController = new VideoPlaybackController();
      window.videoPlaybackController = videoPlaybackController;
      dualAudioEngine = new DualAudioSystem(videoPlaybackController);
      window.dualAudioEngine = dualAudioEngine;
      remoteNavigator = new RemoteControlNavigator();

      // 2. Setup Clock
      updateLiveClock();
      setInterval(updateLiveClock, 30000);

      // 3. Render initial content
      renderCategories();
      renderItems();
      renderAudioSourcePicker();

      // 4. Bind Home Screen Action Cards
      document.getElementById('card-channels').addEventListener('click', () => {
        switchView('view-live');
        setAppMode('live');
      });
      document.getElementById('card-movies').addEventListener('click', () => {
        switchView('view-live');
        setAppMode('movies');
      });
      document.getElementById('card-series').addEventListener('click', () => {
        switchView('view-live');
        setAppMode('series');
      });

      // 5. Explicit Back Button in Top Bar (Returns to Home!)
      document.getElementById('live-btn-back').addEventListener('click', () => {
        if (!exitSeriesEpisodeMode()) {
          switchView('view-home');
          showToast('العودة إلى الشاشة الرئيسية');
        }
      });

      // 6. Sidebar Mode Navigation (Unified 4-column layout)
      document.getElementById('side-nav-live').addEventListener('click', () => setAppMode('live'));
      document.getElementById('side-nav-movies').addEventListener('click', () => setAppMode('movies'));
      document.getElementById('side-nav-series').addEventListener('click', () => setAppMode('series'));
      document.getElementById('side-nav-history').addEventListener('click', () => openModal('modal-epg'));
      document.getElementById('side-nav-settings').addEventListener('click', () => openModal('modal-settings'));

      // 7. Home Top Bar Buttons
      document.getElementById('btn-power').addEventListener('click', () => openModal('modal-power'));
      document.getElementById('btn-refresh').addEventListener('click', async () => {
        if (!iptvState.server) {
          showToast('أضف اشتراك IPTV من الإعدادات أولاً');
          return;
        }
        try { await connectAndLoadIptv(); } catch (error) { showToast(error.message); }
      });
      document.getElementById('btn-profile').addEventListener('click', () => { renderProfile(); openModal('modal-profile'); });
      document.getElementById('btn-settings').addEventListener('click', () => openModal('modal-settings'));
      document.getElementById('btn-search').addEventListener('click', () => openModal('modal-search'));

      // 8. Player Actions
      document.getElementById('btn-open-epg').addEventListener('click', () => {
        if (currentAppMode === 'live') {
          openModal('modal-epg');
        } else {
          showToast(`جارٍ تشغيل ${currentSelectedItem ? currentSelectedItem.name : ''}...`);
        }
      });
      document.getElementById('btn-open-ext-audio').addEventListener('click', () => {
        renderAudioSourcePicker();
        openModal('modal-ext-audio');
      });
      document.getElementById('btn-toggle-fav').addEventListener('click', () => {
        if (currentSelectedItem) toggleFavorite(currentSelectedItem.id);
      });
      document.getElementById('player-heart-btn').addEventListener('click', () => {
        if (currentSelectedItem) toggleFavorite(currentSelectedItem.id);
      });

      // 9. Modals Close Handlers
      document.getElementById('close-ext-audio').addEventListener('click', closeAllModals);
      document.getElementById('btn-ext-audio-done').addEventListener('click', closeAllModals);
      document.getElementById('close-epg').addEventListener('click', closeAllModals);
      document.getElementById('close-epg-footer').addEventListener('click', closeAllModals);
      document.getElementById('close-profile').addEventListener('click', closeAllModals);
      document.getElementById('close-profile-footer').addEventListener('click', closeAllModals);
      document.getElementById('close-settings').addEventListener('click', closeAllModals);
      document.getElementById('close-settings-footer').addEventListener('click', closeAllModals);
      document.getElementById('close-search').addEventListener('click', closeAllModals);
      document.getElementById('close-search-footer').addEventListener('click', closeAllModals);
      document.getElementById('close-power').addEventListener('click', closeAllModals);
      document.getElementById('btn-cancel-exit').addEventListener('click', closeAllModals);
      document.getElementById('btn-confirm-exit').addEventListener('click', () => {
        closeAllModals();
        videoPlaybackController.stopAndRelease();
        if (dualAudioEngine) dualAudioEngine.releaseAll();
        showToast('تم إغلاق الجلسة بنجاح');
        if (window.AndroidBridge && typeof window.AndroidBridge.closeApp === 'function') {
          window.AndroidBridge.closeApp();
        }
      });

      document.getElementById('iptv-login-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          await connectAndLoadIptv();
        } catch (error) {
          const status = document.getElementById('iptv-connection-status');
          if (status) status.textContent = error.message || 'تعذر تسجيل الدخول، تحقق من البيانات وحاول مجدداً';
        }
      });

      // 10. Search Filters
      document.getElementById('cat-filter-input').addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        document.querySelectorAll('.category-item').forEach(item => {
          const text = item.textContent.toLowerCase();
          item.style.display = text.includes(val) ? 'flex' : 'none';
        });
      });

      document.getElementById('live-channel-search').addEventListener('input', (e) => {
        renderItems(e.target.value.trim());
      });

      document.getElementById('audio-src-filter').addEventListener('input', (e) => {
        renderAudioSourcePicker(e.target.value.trim());
      });

      // 11. Global Search
      document.getElementById('global-search-input').addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        const resultsContainer = document.getElementById('global-search-results');
        resultsContainer.replaceChildren();
        const addMessage = (message) => {
          const node = document.createElement('div');
          node.style.cssText = 'text-align:center; color:var(--text-muted); padding:20px; font-size:0.85rem;';
          node.textContent = message;
          resultsContainer.appendChild(node);
        };
        if (!query) {
          addMessage('ابدأ بالكتابة للبحث الفوري...');
          return;
        }

        const groups = [
          { mode: 'live', icon: '📺', label: 'قناة مباشرة', items: iptvLiveChannels, quality: false },
          { mode: 'movies', icon: '🎬', label: 'فيلم', items: iptvVodMovies, quality: true },
          { mode: 'series', icon: '🍿', label: 'مسلسل', items: iptvSeries, quality: true }
        ];
        let total = 0;
        groups.forEach(group => {
          group.items.filter(item => String(item.name || '').toLowerCase().includes(query)).forEach(item => {
            total++;
            const row = document.createElement('div');
            row.className = 'audio-picker-item focusable';
            row.style.background = '#0A0F14';
            row.tabIndex = 0;
            const name = document.createElement('span');
            name.style.cssText = 'color:#fff; font-weight:700;';
            name.textContent = group.icon + ' ' + item.name;
            const meta = document.createElement('span');
            meta.style.cssText = 'font-size:0.75rem;';
            meta.style.color = group.mode === 'movies' ? 'var(--accent-gold)' : 'var(--focus-blue)';
            meta.textContent = group.quality && item.quality ? group.label + ' ' + item.quality : group.label;
            row.append(name, meta);
            row.addEventListener('click', () => {
              closeAllModals();
              switchView('view-live');
              setAppMode(group.mode);
              selectItem(item);
            });
            resultsContainer.appendChild(row);
          });
        });
        if (!total) addMessage('لم يتم العثور على أي نتائج');
      });

      // Restore encrypted credentials and validate the subscription automatically.
      // The login form remains available if the saved account is no longer valid.
      let restoredCredentials = false;
      if (window.AndroidBridge && typeof window.AndroidBridge.loadIptvConfig === 'function') {
        try {
          const saved = JSON.parse(window.AndroidBridge.loadIptvConfig() || '{}');
          if (saved.server && saved.username && saved.password) {
            document.getElementById('iptv-server-url').value = saved.server;
            document.getElementById('iptv-username').value = saved.username;
            document.getElementById('iptv-password').value = saved.password;
            restoredCredentials = true;
          }
        } catch (_) {
          console.warn('Saved IPTV configuration could not be loaded');
        }
      }

      switchView('view-login');
      if (restoredCredentials) {
        const status = document.getElementById('iptv-connection-status');
        if (status) status.textContent = 'جارٍ التحقق من الاشتراك المحفوظ...';
        connectAndLoadIptv(false).catch(error => {
          switchView('view-login');
          if (status) status.textContent = (error && error.message) || 'تعذر استعادة الاشتراك؛ تحقق من الاتصال أو بيانات الدخول';
          const initialFocus = document.getElementById('iptv-server-url');
          if (initialFocus && remoteNavigator) remoteNavigator.focusElement(initialFocus);
        });
      } else {
        const initialFocus = document.getElementById('iptv-server-url');
        if (initialFocus && remoteNavigator) remoteNavigator.focusElement(initialFocus);
      }
    });
