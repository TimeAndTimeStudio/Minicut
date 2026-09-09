// Minicut — Editor Interaction Logic (Phase 5)
(function () {
  'use strict';

  // ======================== STATE ========================
  const state = {
    mediaLibrary: [],
    timeline: {
      outputWidth: 1280,
      outputHeight: 720,
      fps: 30,
      mainTrack: [],
      overlayTracks: { '1': [], '2': [], '3': [] },
    },
    playhead: 0,
    selectedClip: null,
    totalDuration: 0,
    pixelPerSecond: 50,
    isPlaying: false,
    animFrameId: null,
  };

  // ======================== DOM REFS ========================
  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#preview-canvas');
  const ctx = canvas.getContext('2d');
  const fileInput = $('#file-input');
  const mediaLibrary = $('#media-library');
  const mainTrackEl = $('#main-track');
  const exportBtn = $('#export-btn');
  const exportStatus = $('#export-status');

  // ======================== MEDIA LIBRARY ========================
  fileInput.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files.length) return;

    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const resp = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          console.error('Upload failed:', err);
          continue;
        }
        const media = await resp.json();
        state.mediaLibrary.push(media);
        renderMediaLibrary();
      } catch (err) {
        console.error('Upload error:', err);
      }
    }
    fileInput.value = '';
  });

  function renderMediaLibrary() {
    mediaLibrary.innerHTML = '';
    for (const media of state.mediaLibrary) {
      const thumb = document.createElement('div');
      thumb.className = 'media-item';
      thumb.draggable = true;
      thumb.dataset.mediaId = media.id;
      thumb.innerHTML = `<video src="/api/media/${media.id}/stream" muted preload="metadata"></video>
        <span class="media-name">${media.filename.split('/').pop().slice(0, 20)}</span>
        <span class="media-dur">${media.duration.toFixed(1)}s</span>`;

      thumb.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('mediaId', media.id);
        e.dataTransfer.setData('type', 'new-clip');
      });

      mediaLibrary.appendChild(thumb);
    }
  }

  // ======================== TRACK SETUP ========================
  function setupTracks() {
    const tracks = [
      { el: mainTrackEl, trackIndex: 0, isMain: true },
      { el: $('#overlay-track-1'), trackIndex: 1, isMain: false },
      { el: $('#overlay-track-2'), trackIndex: 2, isMain: false },
      { el: $('#overlay-track-3'), trackIndex: 3, isMain: false },
    ];

    for (const { el, trackIndex, isMain } of tracks) {
      if (!el) continue;

      // Drop zone for new clips from media library
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('drag-over');
      });

      el.addEventListener('dragleave', () => {
        el.classList.remove('drag-over');
      });

      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');

        const mediaId = e.dataTransfer.getData('mediaId');
        const type = e.dataTransfer.getData('type');

        if (type === 'new-clip' && mediaId) {
          const media = state.mediaLibrary.find((m) => m.id === mediaId);
          if (!media) return;

          const rect = el.getBoundingClientRect();
          const x = e.clientX - rect.left + el.scrollLeft;
          const timelineStart = Math.max(0, x / state.pixelPerSecond);

          if (isMain) {
            const clip = {
              id: 'clip_' + crypto.randomUUID().replace(/-/g, ''),
              sourceId: mediaId,
              type: 'video',
              sourceIn: 0,
              sourceOut: media.duration,
              trackIndex: 0,
            };
            state.timeline.mainTrack.push(clip);
          } else {
            const clip = {
              id: 'clip_' + crypto.randomUUID().replace(/-/g, ''),
              sourceId: mediaId,
              sourceIn: 0,
              sourceOut: media.duration,
              trackIndex,
              timelineStart,
              x: 20,
              y: 20,
              width: 320,
              height: 180,
              opacity: 1.0,
            };
            state.timeline.overlayTracks[String(trackIndex)].push(clip);
          }

          recalcTotalDuration();
          renderTimeline();
          renderCanvas();
        }
      });
    }
  }

  // ======================== TOTAL DURATION ========================
  function recalcTotalDuration() {
    state.totalDuration = state.timeline.mainTrack.reduce((sum, clip) => {
      return sum + ((clip.sourceOut || 0) - (clip.sourceIn || 0));
    }, 0);
  }

  // ======================== TIMELINE RENDERING ========================
  function renderTimeline() {
    renderMainTrack();
    renderOverlayTracks();
    updatePixelPerSecond();
    exportBtn.disabled = state.timeline.mainTrack.length === 0;
  }

  function updatePixelPerSecond() {
    const panelWidth = mainTrackEl.clientWidth;
    if (state.totalDuration > 0) {
      state.pixelPerSecond = Math.max(10, Math.min(200, panelWidth / state.totalDuration));
    }
    renderMainTrack();
    renderOverlayTracks();
  }

  function renderMainTrack() {
    mainTrackEl.innerHTML = '';
    const clips = state.timeline.mainTrack;
    const trackIndex = 0;

    clips.forEach((clip, index) => {
      const duration = clip.sourceOut - clip.sourceIn;
      const width = duration * state.pixelPerSecond;

      const el = document.createElement('div');
      el.className = 'clip clip-main';
      el.dataset.clipId = clip.id;
      el.dataset.trackIndex = trackIndex;
      el.dataset.index = index;
      el.style.width = width + 'px';
      el.style.left = (index === 0 ? 0 : getCumulativeLeft(clips, index)) + 'px';
      el.title = `Clip: ${clip.sourceId} | ${duration.toFixed(2)}s`;

      el.innerHTML = `<span class="clip-label">${clip.sourceId.slice(-8)}</span>
        <div class="clip-handle clip-handle-left"></div>
        <div class="clip-handle clip-handle-right"></div>`;

      // Drag reorder
      el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('clip-handle')) return;
        startMainDrag(e, clip, index);
      });

      // Resize (trim)
      el.querySelector('.clip-handle-left').addEventListener('mousedown', (e) => {
        e.stopPropagation();
        startMainResize(e, clip, index, 'left');
      });
      el.querySelector('.clip-handle-right').addEventListener('mousedown', (e) => {
        e.stopPropagation();
        startMainResize(e, clip, index, 'right');
      });

      // Selection
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectClip(clip);
      });

      mainTrackEl.appendChild(el);
    });

    // Playhead
    const playhead = document.createElement('div');
    playhead.className = 'playhead';
    playhead.style.left = (state.playhead * state.pixelPerSecond) + 'px';
    mainTrackEl.appendChild(playhead);
  }

  function getCumulativeLeft(clips, index) {
    let left = 0;
    for (let i = 0; i < index; i++) {
      left += (clips[i].sourceOut - clips[i].sourceIn) * state.pixelPerSecond;
    }
    return left;
  }

  function renderOverlayTracks() {
    for (let trackIdx = 1; trackIdx <= 3; trackIdx++) {
      const trackEl = document.getElementById(`overlay-track-${trackIdx}`);
      if (!trackEl) continue;
      trackEl.innerHTML = '';

      const clips = state.timeline.overlayTracks[String(trackIdx)];
      clips.forEach((clip) => {
        const duration = clip.sourceOut - clip.sourceIn;
        const width = duration * state.pixelPerSecond;
        const left = (clip.timelineStart || 0) * state.pixelPerSecond;

        const el = document.createElement('div');
        el.className = 'clip clip-overlay';
        el.dataset.clipId = clip.id;
        el.dataset.trackIndex = trackIdx;
        el.style.left = left + 'px';
        el.style.width = width + 'px';
        el.style.top = '4px';
        el.title = `Overlay track ${trackIdx} | ${duration.toFixed(2)}s`;

        el.innerHTML = `<span class="clip-label">OV${trackIdx}:${clip.sourceId.slice(-6)}</span>
          <div class="clip-handle clip-handle-left"></div>
          <div class="clip-handle clip-handle-right"></div>`;

        // Drag to reposition
        el.addEventListener('mousedown', (e) => {
          if (e.target.classList.contains('clip-handle')) return;
          startOverlayDrag(e, clip, trackIdx);
        });

        // Resize
        el.querySelector('.clip-handle-left').addEventListener('mousedown', (e) => {
          e.stopPropagation();
          startOverlayResize(e, clip, trackIdx, 'left');
        });
        el.querySelector('.clip-handle-right').addEventListener('mousedown', (e) => {
          e.stopPropagation();
          startOverlayResize(e, clip, trackIdx, 'right');
        });

        // Selection
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          selectClip(clip);
        });

        trackEl.appendChild(el);
      });

      // Playhead for overlay tracks too
      const playhead = document.createElement('div');
      playhead.className = 'playhead';
      playhead.style.left = (state.playhead * state.pixelPerSecond) + 'px';
      trackEl.appendChild(playhead);
    }
  }

  // ======================== CLIP SELECTION ========================
  function selectClip(clip) {
    state.selectedClip = clip;

    // Remove old selection visuals
    document.querySelectorAll('.clip.selected').forEach((el) => el.classList.remove('selected'));

    // Add selection visual
    const clipEl = document.querySelector(`.clip[data-clip-id="${clip.id}"]`);
    if (clipEl) clipEl.classList.add('selected');

    // Show properties panel
    renderPropertiesPanel(clip);
  }

  function clearSelection() {
    state.selectedClip = null;
    document.querySelectorAll('.clip.selected').forEach((el) => el.classList.remove('selected'));
    const panel = $('#properties-panel');
    if (panel) panel.remove();
  }

  function renderPropertiesPanel(clip) {
    // Remove existing panel
    const existing = $('#properties-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'properties-panel';

    const isOverlay = clip.trackIndex >= 1 && clip.trackIndex <= 3;

    let html = `<h3>Clip Properties</h3>
      <div class="prop-row">
        <label>Opacity: <span id="opacity-value">${(clip.opacity || 1.0).toFixed(2)}</span></label>
        <input type="range" id="opacity-slider" min="0" max="100" value="${(clip.opacity || 1.0) * 100}" step="1">
      </div>`;

    if (isOverlay) {
      const duration = clip.sourceOut - clip.sourceIn;
      html += `<div class="prop-row">
        <label>Timeline Start: ${clip.timelineStart.toFixed(2)}s</label>
      </div>
      <div class="prop-row">
        <label>Duration: ${duration.toFixed(2)}s</label>
      </div>
      <div class="prop-row">
        <label>X: <input type="number" id="prop-x" value="${clip.x || 0}" min="0"></label>
        <label>Y: <input type="number" id="prop-y" value="${clip.y || 0}" min="0"></label>
      </div>
      <div class="prop-row">
        <label>Width: <input type="number" id="prop-w" value="${clip.width || 320}" min="10"></label>
        <label>Height: <input type="number" id="prop-h" value="${clip.height || 180}" min="10"></label>
      </div>`;
    }

    html += `<div class="prop-row">
      <button id="delete-clip-btn" style="background:#e94560;color:#fff;border:none;padding:4px 12px;border-radius:3px;cursor:pointer;">Delete Clip</button>
    </div>`;

    panel.innerHTML = html;
    panel.style.cssText = 'position:fixed;right:10px;top:100px;background:#16213e;border:1px solid #0f3460;padding:12px;border-radius:6px;z-index:100;min-width:220px;';

    document.body.appendChild(panel);

    // Opacity slider
    const slider = $('#opacity-slider');
    const opacityValue = $('#opacity-value');
    slider.addEventListener('input', () => {
      const val = parseInt(slider.value, 10) / 100;
      clip.opacity = val;
      opacityValue.textContent = val.toFixed(2);
      renderCanvas();
    });

    // Position/size inputs
    ['x', 'y', 'w', 'h'].forEach((key) => {
      const input = document.getElementById(`prop-${key}`);
      if (input) {
        input.addEventListener('change', () => {
          const val = parseInt(input.value, 10);
          if (key === 'x') clip.x = val;
          if (key === 'y') clip.y = val;
          if (key === 'w') clip.width = val;
          if (key === 'h') clip.height = val;
          renderCanvas();
        });
      }
    });

    // Delete button
    const deleteBtn = $('#delete-clip-btn');
    deleteBtn.addEventListener('click', () => {
      deleteClip(clip);
    });
  }

  // ======================== MAIN TRACK DRAG (REORDER) ========================
  function startMainDrag(e, clip, index) {
    const trackEl = mainTrackEl;
    const rect = trackEl.getBoundingClientRect();
    const startX = e.clientX;
    const originalIndex = index;

    document.addEventListener('mousemove', onMainDrag);
    document.addEventListener('mouseup', onMainDragEnd);

    function onMainDrag(e) {
      const dx = e.clientX - startX;
      const threshold = state.pixelPerSecond * 0.5;

      if (Math.abs(dx) < threshold) return;

      // Calculate new index based on drag direction
      let newIndex = originalIndex + (dx > 0 ? 1 : -1);
      newIndex = Math.max(0, Math.min(newIndex, state.timeline.mainTrack.length - 1));

      if (newIndex !== originalIndex) {
        const clips = state.timeline.mainTrack;
        const [moved] = clips.splice(originalIndex, 1);
        clips.splice(newIndex, 0, moved);
        renderTimeline();
      }
    }

    function onMainDragEnd() {
      document.removeEventListener('mousemove', onMainDrag);
      document.removeEventListener('mouseup', onMainDragEnd);
    }
  }

  // ======================== MAIN TRACK RESIZE (TRIM) ========================
  function startMainResize(e, clip, index, side) {
    const trackEl = mainTrackEl;
    const trackRect = trackEl.getBoundingClientRect();
    const startX = e.clientX;
    const originalSourceIn = clip.sourceIn;
    const originalSourceOut = clip.sourceOut;
    const media = state.mediaLibrary.find((m) => m.id === clip.sourceId);

    document.addEventListener('mousemove', onMainResize);
    document.addEventListener('mouseup', onMainResizeEnd);

    function onMainResize(e) {
      const dx = e.clientX - startX;
      const dt = dx / state.pixelPerSecond;

      if (side === 'left') {
        const newIn = Math.max(0, Math.min(originalSourceIn + dt, originalSourceOut - 0.1));
        clip.sourceIn = newIn;
      } else {
        const maxOut = media ? Math.min(originalSourceIn + 10, media.duration) : originalSourceOut + 10;
        const newOut = Math.max(originalSourceIn + 0.1, Math.min(originalSourceOut + dt, maxOut));
        clip.sourceOut = newOut;
      }

      renderTimeline();
      renderCanvas();
    }

    function onMainResizeEnd() {
      document.removeEventListener('mousemove', onMainResize);
      document.removeEventListener('mouseup', onMainResizeEnd);
      recalcTotalDuration();
    }
  }

  // ======================== OVERLAY DRAG ========================
  function startOverlayDrag(e, clip, trackIdx) {
    const trackEl = document.getElementById(`overlay-track-${trackIdx}`);
    const trackRect = trackEl.getBoundingClientRect();
    const startX = e.clientX;
    const startLeft = (clip.timelineStart || 0) * state.pixelPerSecond;
    const originalStart = clip.timelineStart;
    const duration = clip.sourceOut - clip.sourceIn;

    document.addEventListener('mousemove', onOverlayDrag);
    document.addEventListener('mouseup', onOverlayDragEnd);

    function onOverlayDrag(e) {
      const dx = e.clientX - startX;
      const newLeft = startLeft + dx;
      let newStart = Math.max(0, newLeft / state.pixelPerSecond);

      // Check overlap with other clips in same track
      const clips = state.timeline.overlayTracks[String(trackIdx)];
      const overlap = clips.find((c) => {
        if (c.id === clip.id) return false;
        const otherStart = c.timelineStart || 0;
        const otherDuration = c.sourceOut - c.sourceIn;
        const newEnd = newStart + duration;
        const otherEnd = otherStart + otherDuration;
        return newStart < otherEnd && otherStart < newEnd;
      });

      if (!overlap) {
        clip.timelineStart = newStart;
        renderOverlayTracks();
        renderCanvas();
      }
    }

    function onOverlayDragEnd(e) {
      document.removeEventListener('mousemove', onOverlayDrag);
      document.removeEventListener('mouseup', onOverlayDragEnd);

      // Snap back if overlap detected
      const clips = state.timeline.overlayTracks[String(trackIdx)];
      const overlap = clips.find((c) => c.id !== clip.id && Math.abs(c.timelineStart - originalStart) < duration * 0.1);
      if (overlap) {
        clip.timelineStart = originalStart;
        renderOverlayTracks();
      }
    }
  }

  // ======================== OVERLAY RESIZE ========================
  function startOverlayResize(e, clip, trackIdx, side) {
    const startX = e.clientX;
    const originalIn = clip.sourceIn;
    const originalOut = clip.sourceOut;
    const media = state.mediaLibrary.find((m) => m.id === clip.sourceId);

    document.addEventListener('mousemove', onOverlayResize);
    document.addEventListener('mouseup', onOverlayResizeEnd);

    function onOverlayResize(e) {
      const dx = e.clientX - startX;
      const dt = dx / state.pixelPerSecond;

      if (side === 'left') {
        const newIn = Math.max(0, Math.min(originalIn + dt, originalOut - 0.1));
        clip.sourceIn = newIn;
      } else {
        const maxOut = media ? Math.min(originalOut + dt, media.duration) : originalOut + 10;
        const newOut = Math.max(originalIn + 0.1, Math.min(originalOut + dt, maxOut));
        clip.sourceOut = newOut;
      }

      renderOverlayTracks();
      renderCanvas();
    }

    function onOverlayResizeEnd() {
      document.removeEventListener('mousemove', onOverlayResize);
      document.removeEventListener('mouseup', onOverlayResizeEnd);
    }
  }

  // ======================== OVERLAY CROSS-TRACK DRAG ========================
  function setupOverlayCrossTrack() {
    for (let trackIdx = 1; trackIdx <= 3; trackIdx++) {
      const trackEl = document.getElementById(`overlay-track-${trackIdx}`);
      if (!trackEl) continue;

      trackEl.addEventListener('dragover', (e) => {
        e.preventDefault();
      });

      trackEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const clipId = e.dataTransfer.getData('clipId');
        const sourceTrack = parseInt(e.dataTransfer.getData('sourceTrack'), 10);

        if (!clipId || isNaN(sourceTrack)) return;

        // Find the clip
        const clips = state.timeline.overlayTracks[String(sourceTrack)];
        if (!clips) return;
        const clip = clips.find((c) => c.id === clipId);
        if (!clip) return;

        // Don't allow moving to main track
        if (trackIdx === 0) return;

        // Don't allow moving to same track
        if (sourceTrack === trackIdx) return;

        // Remove from source track
        const srcIndex = clips.indexOf(clip);
        clips.splice(srcIndex, 1);

        // Add to target track
        clip.trackIndex = trackIdx;
        state.timeline.overlayTracks[String(trackIdx)].push(clip);

        renderTimeline();
        renderCanvas();
      });
    }
  }

  // ======================== CLIP SPLIT ========================
  function splitClipAtPlayhead() {
    // Split main track clips
    const clips = state.timeline.mainTrack;
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const cumulativeStart = getCumulativeTime(clips, i);
      const cumulativeEnd = cumulativeStart + (clip.sourceOut - clip.sourceIn);

      if (state.playhead > cumulativeStart && state.playhead < cumulativeEnd) {
        const splitTimeInClip = state.playhead - cumulativeStart;
        const splitSourceTime = clip.sourceIn + splitTimeInClip;

        const newClip = {
          id: 'clip_' + crypto.randomUUID().replace(/-/g, ''),
          sourceId: clip.sourceId,
          type: 'video',
          sourceIn: splitSourceTime,
          sourceOut: clip.sourceOut,
          trackIndex: 0,
        };

        clip.sourceOut = splitSourceTime;
        clips.splice(i + 1, 0, newClip);
        recalcTotalDuration();
        renderTimeline();
        renderCanvas();
        return;
      }
    }

    // Split overlay track clips
    for (let trackIdx = 1; trackIdx <= 3; trackIdx++) {
      const oClips = state.timeline.overlayTracks[String(trackIdx)];
      for (const oClip of oClips) {
        if (
          state.playhead > oClip.timelineStart &&
          state.playhead < oClip.timelineStart + (oClip.sourceOut - oClip.sourceIn)
        ) {
          const splitTimeInClip = state.playhead - oClip.timelineStart;
          const splitSourceTime = oClip.sourceIn + splitTimeInClip;

          const newClip = {
            id: 'clip_' + crypto.randomUUID().replace(/-/g, ''),
            sourceId: oClip.sourceId,
            sourceIn: splitSourceTime,
            sourceOut: oClip.sourceOut,
            trackIndex: trackIdx,
            timelineStart: oClip.timelineStart + splitTimeInClip,
            x: oClip.x,
            y: oClip.y,
            width: oClip.width,
            height: oClip.height,
            opacity: oClip.opacity,
          };

          oClip.sourceOut = splitSourceTime;
          const idx = oClips.indexOf(oClip);
          oClips.splice(idx + 1, 0, newClip);
          renderTimeline();
          renderCanvas();
          return;
        }
      }
    }
  }

  function getCumulativeTime(clips, index) {
    let time = 0;
    for (let i = 0; i < index; i++) {
      time += clips[i].sourceOut - clips[i].sourceIn;
    }
    return time;
  }

  // ======================== DELETE CLIP ========================
  function deleteClip(clip) {
    // Main track
    const mainIdx = state.timeline.mainTrack.indexOf(clip);
    if (mainIdx !== -1) {
      state.timeline.mainTrack.splice(mainIdx, 1);
      recalcTotalDuration();
      renderTimeline();
      renderCanvas();
      clearSelection();
      return;
    }

    // Overlay tracks
    for (let trackIdx = 1; trackIdx <= 3; trackIdx++) {
      const clips = state.timeline.overlayTracks[String(trackIdx)];
      const idx = clips.indexOf(clip);
      if (idx !== -1) {
        clips.splice(idx, 1);
        renderTimeline();
        renderCanvas();
        clearSelection();
        return;
      }
    }
  }

  // ======================== CANVAS PREVIEW ========================
  function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { mainTrack, overlayTracks } = state.timeline;
    const playheadTime = state.playhead;

    // Draw main track clips at playhead position
    let cumulativeTime = 0;
    for (const clip of mainTrack) {
      const clipStart = cumulativeTime;
      const clipEnd = cumulativeTime + (clip.sourceOut - clip.sourceIn);

      if (playheadTime >= clipStart && playheadTime < clipEnd) {
        const media = state.mediaLibrary.find((m) => m.id === clip.sourceId);
        if (media) {
          const videoEl = getVideoElement(clip.sourceId);
          if (videoEl && videoEl.readyState >= 2) {
            const clipLocalTime = playheadTime - clipStart;
            const sourceTime = clip.sourceIn + clipLocalTime;

            // Calculate scale to fit canvas
            const scale = Math.min(
              canvas.width / media.width,
              canvas.height / media.height
            );
            const w = media.width * scale;
            const h = media.height * scale;
            const x = (canvas.width - w) / 2;
            const y = (canvas.height - h) / 2;

            ctx.drawImage(videoEl, x, y, w, h);
          }
        }
      }

      cumulativeTime = clipEnd;
    }

    // Draw overlay tracks (track 1 -> 2 -> 3, low to high z-order)
    for (let trackIdx = 1; trackIdx <= 3; trackIdx++) {
      const clips = overlayTracks[String(trackIdx)];
      if (!clips || clips.length === 0) continue;

      for (const clip of clips) {
        const clipDuration = clip.sourceOut - clip.sourceIn;
        const clipStart = clip.timelineStart;
        const clipEnd = clipStart + clipDuration;

        if (playheadTime >= clipStart && playheadTime < clipEnd) {
          const media = state.mediaLibrary.find((m) => m.id === clip.sourceId);
          if (media) {
            const videoEl = getVideoElement(clip.sourceId);
            if (videoEl && videoEl.readyState >= 2) {
              const clipLocalTime = playheadTime - clipStart;
              const sourceTime = clip.sourceIn + clipLocalTime;

              // Seek video to correct position
              if (Math.abs(videoEl.currentTime - sourceTime) > 0.1) {
                videoEl.currentTime = sourceTime;
              }

              const opacity = clip.opacity !== undefined ? clip.opacity : 1.0;
              ctx.globalAlpha = opacity;
              ctx.drawImage(
                videoEl,
                clip.x || 0,
                clip.y || 0,
                clip.width || 320,
                clip.height || 180
              );
              ctx.globalAlpha = 1.0;
            }
          }
        }
      }
    }
  }

  // Hidden video elements pool
  const videoPool = new Map();

  function getVideoElement(mediaId) {
    if (videoPool.has(mediaId)) {
      return videoPool.get(mediaId);
    }

    const video = document.createElement('video');
    video.src = `/api/media/${mediaId}/stream`;
    video.muted = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.style.display = 'none';
    document.body.appendChild(video);

    videoPool.set(mediaId, video);
    return video;
  }

  // ======================== PLAYBACK ========================
  let lastFrameTime = 0;

  function startPlayback() {
    if (state.isPlaying) return;
    state.isPlaying = true;
    lastFrameTime = performance.now();
    playLoop();
  }

  function stopPlayback() {
    state.isPlaying = false;
    if (state.animFrameId) {
      cancelAnimationFrame(state.animFrameId);
      state.animFrameId = null;
    }
  }

  function playLoop() {
    if (!state.isPlaying) return;

    const now = performance.now();
    const delta = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    state.playhead += delta;

    // Stop at end of timeline
    if (state.playhead >= state.totalDuration) {
      state.playhead = state.totalDuration;
      stopPlayback();
    }

    renderCanvas();
    renderTimeline();
    state.animFrameId = requestAnimationFrame(playLoop);
  }

  // ======================== CANVAS SCRUB ========================
  function setupCanvasScrub() {
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Map canvas position to timeline time
      const time = (x / canvas.width) * state.totalDuration;

      state.playhead = Math.max(0, time);
      renderCanvas();
      renderTimeline();
    });
  }

  // ======================== EXPORT ========================
  exportBtn.addEventListener('click', async () => {
    const { mainTrack } = state.timeline;
    if (!mainTrack || mainTrack.length === 0) {
      exportStatus.textContent = 'No clips in timeline';
      return;
    }

    exportBtn.disabled = true;
    exportStatus.textContent = 'Starting export...';

    try {
      const resp = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.timeline),
      });

      if (resp.status === 400) {
        const data = await resp.json();
        exportStatus.textContent = 'Validation error: ' + (data.errors?.[0] || 'Unknown error');
        exportBtn.disabled = false;
        return;
      }

      if (resp.status === 429) {
        exportStatus.textContent = 'Export busy, please wait...';
        return;
      }

      const data = await resp.json();
      exportStatus.textContent = `Export started: ${data.jobId}`;
      pollExportStatus(data.jobId);
    } catch (err) {
      exportStatus.textContent = 'Export failed: ' + err.message;
      exportBtn.disabled = false;
    }
  });

  function pollExportStatus(jobId) {
    const poll = async () => {
      try {
        const resp = await fetch(`/api/export/${jobId}/status`);
        const data = await resp.json();

        if (data.status === 'running') {
          exportStatus.textContent = `Exporting... ${Math.round(data.progress * 100)}%`;
          setTimeout(poll, 500);
        } else if (data.status === 'done') {
          exportStatus.textContent = `Export complete! [${data.outputPath}]`;
          exportBtn.disabled = false;

          // Add download link
          const downloadLink = document.createElement('a');
          downloadLink.href = `/api/export/${jobId}/download`;
          downloadLink.textContent = 'Download Output';
          downloadLink.style.color = '#4ade80';
          downloadLink.style.marginLeft = '10px';
          downloadLink.download = `${jobId}.mp4`;
          exportStatus.appendChild(downloadLink);
        } else if (data.status === 'failed') {
          exportStatus.textContent = `Export failed: ${data.error || 'Unknown error'}`;
          exportBtn.disabled = false;
        }
      } catch (err) {
        exportStatus.textContent = 'Status poll failed: ' + err.message;
        exportBtn.disabled = false;
      }
    };

    poll();
  }

  // ======================== KEYBOARD SHORTCUTS ========================
  document.addEventListener('keydown', (e) => {
    // Space: play/pause
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      if (state.isPlaying) {
        stopPlayback();
      } else {
        startPlayback();
      }
    }

    // Delete: remove selected clip
    if (e.code === 'Delete' && state.selectedClip) {
      deleteClip(state.selectedClip);
    }

    // S: split clip at playhead
    if (e.code === 'KeyS' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      splitClipAtPlayhead();
    }
  });

  // ======================== INIT ========================
  function init() {
    setupTracks();
    setupOverlayCrossTrack();
    setupCanvasScrub();
    renderTimeline();
    renderCanvas();

    // Click on empty area to deselect
    document.addEventListener('click', (e) => {
      if (e.target === canvas || e.target.id === 'timeline-panel' || e.target.id === 'app') {
        clearSelection();
      }
    });
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
