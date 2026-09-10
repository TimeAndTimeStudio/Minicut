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
      tracks: { '0': [], '1': [], '2': [], '3': [] },
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

  // Offscreen canvas for double buffering
  const offscreen = document.createElement('canvas');
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const offCtx = offscreen.getContext('2d');
  const fileInput = $('#file-input');
  const mediaLibrary = $('#media-library');
  const mainTrackEl = $('#main-track');
  const exportBtn = $('#export-btn');
  const splitBtn = $('#split-btn');
  const exportStatus = $('#export-status');
  const playBtn = $('#play-btn');
  const playIcon = $('#play-icon');
  const pauseIcon = $('#pause-icon');
  const timecodeCurrent = $('#timecode-current');
  const timecodeTotal = $('#timecode-total');

  const TRACK_TAGS = { 0: 'MAIN', 1: 'OVERLAY 1', 2: 'OVERLAY 2', 3: 'OVERLAY 3' };

  function formatTimecode(seconds) {
    const s = Math.max(0, seconds || 0);
    const m = Math.floor(s / 60);
    const rem = (s % 60).toFixed(1).padStart(4, '0');
    return `${String(m).padStart(2, '0')}:${rem}`;
  }

  function updateTimecode() {
    if (timecodeCurrent) timecodeCurrent.textContent = formatTimecode(state.playhead);
    if (timecodeTotal) timecodeTotal.textContent = formatTimecode(state.totalDuration);
  }

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (state.isPlaying) {
        stopPlayback();
      } else {
        startPlayback();
      }
    });
  }

  function setPlayButtonState(isPlaying) {
    if (!playIcon || !pauseIcon) return;
    playIcon.style.display = isPlaying ? 'none' : '';
    pauseIcon.style.display = isPlaying ? '' : 'none';
  }

  // ======================== MEDIA LIBRARY ========================
  async function loadMediaLibrary() {
    try {
      const resp = await fetch('/api/media');
      const mediaList = await resp.json();
      state.mediaLibrary = mediaList;
      renderMediaLibrary();
    } catch (err) {
      console.error('Failed to load media:', err);
    }
  }

  async function deleteMedia(mediaId) {
    try {
      const resp = await fetch(`/api/media/${mediaId}`, { method: 'DELETE' });
      if (resp.ok) {
        state.mediaLibrary = state.mediaLibrary.filter(m => m.id !== mediaId);
        renderMediaLibrary();
      }
    } catch (err) {
      console.error('Failed to delete media:', err);
    }
  }

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

      if (media.hasVideo) {
        thumb.innerHTML = `<video src="/api/media/${media.id}/stream" muted preload="metadata"></video>
          <span class="media-name">${media.filename.split('/').pop().slice(0, 20)}</span>
          <span class="media-dur">${media.duration.toFixed(1)}s</span>
          <button class="delete-media-btn" data-media-id="${media.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          </button>`;
      } else {
        thumb.innerHTML = `<div class="audio-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
          </div>
          <span class="media-name">${media.filename.split('/').pop().slice(0, 20)}</span>
          <span class="media-dur">${media.duration.toFixed(1)}s</span>
          <button class="delete-media-btn" data-media-id="${media.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          </button>`;
      }

      thumb.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('mediaId', media.id);
        e.dataTransfer.setData('type', 'new-clip');
      });

      const deleteBtn = thumb.querySelector('.delete-media-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteMedia(media.id);
        });
      }

      mediaLibrary.appendChild(thumb);
    }
  }

  // ======================== TRACK SETUP ========================
  function setupTracks() {
    const tracks = [
      { el: mainTrackEl, trackIndex: 0 },
      { el: $('#overlay-track-1'), trackIndex: 1 },
      { el: $('#overlay-track-2'), trackIndex: 2 },
      { el: $('#overlay-track-3'), trackIndex: 3 },
    ];

    for (const { el, trackIndex } of tracks) {
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
          const timelineStart = trackIndex === 0 ? 0 : Math.max(0, x / state.pixelPerSecond);

          const isVideoOrImage = media.hasVideo || (media.contentType && media.contentType.startsWith('image/'));

          const clip = {
            id: 'clip_' + crypto.randomUUID().replace(/-/g, ''),
            sourceId: mediaId,
            type: isVideoOrImage ? (media.contentType && media.contentType.startsWith('image/') ? 'image' : 'video') : 'audio',
            sourceIn: 0,
            sourceOut: media.duration,
            trackIndex: trackIndex,
            timelineStart: timelineStart,
            opacity: 1.0,
          };

          if (isVideoOrImage) {
            if (trackIndex === 0) {
              clip.x = undefined;
              clip.y = undefined;
              clip.width = media.width || 1280;
              clip.height = media.height || 720;
            } else {
              clip.x = 20;
              clip.y = 20;
              clip.width = 320;
              clip.height = 180;
            }
          }

          state.timeline.tracks[String(trackIndex)].push(clip);

          recalcTotalDuration();
          renderTimeline();
          renderCanvas();
        }
      });
    }
  }

  // ======================== TOTAL DURATION ========================
  // Total timeline length must cover every track, not just the main track (0).
  // Overlay clips (tracks 1-3) can be dragged/placed further out on the
  // timeline than the last main-track clip, and playback should run to
  // whichever point is furthest — otherwise it stops as soon as the main
  // track ends even though an overlay is still visible past that point.
  function recalcTotalDuration() {
    let maxEnd = 0;
    for (let trackIndex = 0; trackIndex <= 3; trackIndex++) {
      const clips = state.timeline.tracks[String(trackIndex)] || [];
      for (const clip of clips) {
        const clipStart = clip.timelineStart || 0;
        const clipEnd = clipStart + ((clip.sourceOut || 0) - (clip.sourceIn || 0));
        if (clipEnd > maxEnd) maxEnd = clipEnd;
      }
    }
    state.totalDuration = maxEnd;
  }

  // ======================== TIMELINE RENDERING ========================
  function renderTimeline() {
    updatePixelPerSecond();
    updateTimecode();
    exportBtn.disabled = state.timeline.tracks['0'].length === 0;

    // Enable split button if playhead is within any clip
    let playheadInClip = false;
    for (let trackIndex = 0; trackIndex <= 3; trackIndex++) {
      const clips = state.timeline.tracks[String(trackIndex)];
      for (const clip of clips) {
        const clipStart = clip.timelineStart || 0;
        const clipEnd = clipStart + (clip.sourceOut - clip.sourceIn);
        if (state.playhead >= clipStart && state.playhead <= clipEnd) {
          playheadInClip = true;
          break;
        }
      }
      if (playheadInClip) break;
    }
    splitBtn.disabled = !playheadInClip;
  }

  function updatePixelPerSecond() {
    const panelWidth = mainTrackEl.clientWidth;
    if (state.totalDuration > 0) {
      state.pixelPerSecond = Math.max(10, Math.min(200, panelWidth / state.totalDuration));
    }
    renderTracks();
  }

  function renderTracks() {
    for (let trackIndex = 0; trackIndex <= 3; trackIndex++) {
      const trackEl = document.getElementById(
        trackIndex === 0 ? 'main-track' : `overlay-track-${trackIndex}`
      );
      if (!trackEl) continue;

      trackEl.innerHTML = '';

      const tag = document.createElement('span');
      tag.className = 'track-tag';
      tag.textContent = TRACK_TAGS[trackIndex] || '';
      trackEl.appendChild(tag);

      const clips = state.timeline.tracks[String(trackIndex)];

      clips.forEach((clip) => {
        const duration = clip.sourceOut - clip.sourceIn;
        const width = duration * state.pixelPerSecond;
        const left = (clip.timelineStart || 0) * state.pixelPerSecond;

        const el = document.createElement('div');
        el.className = 'clip';
        el.dataset.clipId = clip.id;
        el.dataset.trackIndex = trackIndex;
        el.style.left = left + 'px';
        el.style.width = width + 'px';
        el.style.top = '4px';

        const label = clip.type === 'audio'
          ? `🎵 A${trackIndex}:${clip.sourceId.slice(-6)}`
          : `${trackIndex === 0 ? 'M' : 'O' + trackIndex}:${clip.sourceId.slice(-6)}`;
        el.innerHTML = `<span class="clip-label">${label}</span>
          <div class="clip-handle clip-handle-left"></div>
          <div class="clip-handle clip-handle-right"></div>`;

        // Drag to reposition
        el.addEventListener('mousedown', (e) => {
          if (e.target.classList.contains('clip-handle')) return;
          if (e.ctrlKey || e.metaKey) return;
          startClipDrag(e, clip, trackIndex);
        });

        // Resize (เฉพาะ video clips)
        if (clip.type === 'video') {
          el.querySelector('.clip-handle-left').addEventListener('mousedown', (e) => {
            e.stopPropagation();
            startClipResize(e, clip, trackIndex, 'left');
          });
          el.querySelector('.clip-handle-right').addEventListener('mousedown', (e) => {
            e.stopPropagation();
            startClipResize(e, clip, trackIndex, 'right');
          });
        }

        // Selection
        el.addEventListener('click', (e) => {
          if (e.target.classList.contains('clip-handle')) return;
          e.stopPropagation();
          if (justDragged) return;
          selectClip(clip);
        });

        trackEl.appendChild(el);
      });

      // Playhead
      const playhead = document.createElement('div');
      playhead.className = 'playhead';
      playhead.style.left = (state.playhead * state.pixelPerSecond) + 'px';
      playhead.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        startPlayheadDrag(e);
      });
      trackEl.appendChild(playhead);
    }
  }

  // ======================== PLAYHEAD DRAG (SCRUB) ========================
  function startPlayheadDrag(e) {
    const trackEl = mainTrackEl;

    document.addEventListener('mousemove', onPlayheadDrag);
    document.addEventListener('mouseup', onPlayheadDragEnd);

    function onPlayheadDrag(e) {
      const rect = trackEl.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const time = Math.max(0, dx / state.pixelPerSecond);
      state.playhead = Math.min(time, state.totalDuration);
      renderTimeline();
      renderCanvas();
    }

    function onPlayheadDragEnd() {
      document.removeEventListener('mousemove', onPlayheadDrag);
      document.removeEventListener('mouseup', onPlayheadDragEnd);
    }
  }



  // ======================== CLIP SELECTION ========================
  function selectClip(clip, showPanel = true) {
    state.selectedClip = clip;

    // Remove old selection visuals
    document.querySelectorAll('.clip.selected').forEach((el) => el.classList.remove('selected'));

    // Add selection visual
    const clipEl = document.querySelector(`.clip[data-clip-id="${clip.id}"]`);
    if (clipEl) clipEl.classList.add('selected');

    // Always refresh the properties panel to the newly selected clip so it
    // never shows stale values (or none at all) from a previously selected
    // clip — it must reflect this clip's real opacity/x/y/width/height.
    if (showPanel) {
      renderPropertiesPanel(clip);
    }
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

    const media = state.mediaLibrary.find((m) => m.id === clip.sourceId);
    const isVideoOrImage = media && !media.contentType.startsWith('audio/');

    let html = `<h3>Clip Properties</h3>
      <div class="prop-row">
        <label>Opacity: <span id="opacity-value">${(clip.opacity !== undefined ? clip.opacity : 1.0).toFixed(2)}</span></label>
        <input type="range" id="opacity-slider" min="0" max="100" value="${(clip.opacity !== undefined ? clip.opacity : 1.0) * 100}" step="1">
      </div>`;

    if (isVideoOrImage) {
      const duration = clip.sourceOut - clip.sourceIn;
      html += `<div class="prop-row">
        <label>Timeline Start: ${clip.timelineStart.toFixed(2)}s</label>
      </div>
      <div class="prop-row">
        <label>Duration: ${duration.toFixed(2)}s</label>
      </div>
      <div class="prop-row">
        <label>X: <input type="number" id="prop-x" value="${clip.x !== undefined ? clip.x : ''}" min="0"></label>
        <label>Y: <input type="number" id="prop-y" value="${clip.y !== undefined ? clip.y : ''}" min="0"></label>
      </div>
      <div class="prop-row">
        <label>Width: <input type="number" id="prop-w" value="${clip.width || media?.width || 1280}" min="10"></label>
        <label>Height: <input type="number" id="prop-h" value="${clip.height || media?.height || 720}" min="10"></label>
      </div>`;
    }

    html += `<div class="prop-row">
      <button id="delete-clip-btn" class="btn" style="background:var(--danger);color:#fff;" onclick="window._handleDeleteClip()">Delete Clip</button>
    </div>`;

    panel.innerHTML = html;

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
  }

  // Global delete handler
  window._handleDeleteClip = () => {
    if (state.selectedClip) {
      deleteClip(state.selectedClip);
    }
  };

  // ======================== UNIFIED CLIP DRAG & RESIZE ========================
  let justDragged = false;

  function startClipDrag(e, clip, sourceTrackIndex) {
    const trackEl = document.getElementById(
      sourceTrackIndex === 0 ? 'main-track' : `overlay-track-${sourceTrackIndex}`
    );
    const startX = e.clientX;
    const startLeft = (clip.timelineStart || 0) * state.pixelPerSecond;
    const originalStart = clip.timelineStart;
    const duration = clip.sourceOut - clip.sourceIn;
    justDragged = false;

    // Create shadow element
    const originalEl = document.querySelector(`.clip[data-clip-id="${clip.id}"]`);
    const shadow = originalEl.cloneNode(true);
    shadow.classList.add('drag-shadow');
    shadow.style.opacity = '0.5';
    trackEl.appendChild(shadow);

    document.addEventListener('mousemove', onClipDrag);
    document.addEventListener('mouseup', onClipDragEnd);

    function onClipDrag(e) {
      if (!justDragged) justDragged = true;

      const dx = e.clientX - startX;
      let newLeft = Math.max(0, startLeft + dx);
      let newStart = newLeft / state.pixelPerSecond;

      // Remove clip from original position temporarily
      const clips = state.timeline.tracks[String(sourceTrackIndex)];
      const idx = clips.indexOf(clip);
      if (idx !== -1) clips.splice(idx, 1);

      const clipEnd = newStart + duration;
      const SNAP_THRESHOLD = 0.1;

      // Snap to adjacent clips
      for (const otherClip of clips) {
        if (otherClip.id === clip.id) continue;
        
        const otherStart = otherClip.timelineStart || 0;
        const otherEnd = otherStart + (otherClip.sourceOut - otherClip.sourceIn);
        
        // Snap to right edge of other clip
        if (Math.abs(newStart - otherEnd) < SNAP_THRESHOLD) {
          newStart = otherEnd;
        }
        // Snap to left edge of other clip
        else if (Math.abs(clipEnd - otherStart) < SNAP_THRESHOLD) {
          newStart = otherStart - duration;
        }
      }

      clip.timelineStart = newStart;
      shadow.style.left = (newStart * state.pixelPerSecond) + 'px';

      // Highlight drop target
      document.querySelectorAll('.track').forEach(t => t.classList.remove('drag-over'));
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const targetTrack = target?.closest?.('.track');
      if (targetTrack) targetTrack.classList.add('drag-over');

      renderCanvas();
    }

    function onClipDragEnd(e) {
      document.removeEventListener('mousemove', onClipDrag);
      document.removeEventListener('mouseup', onClipDragEnd);
      shadow.remove();

      // A plain click (mousedown+mouseup with no movement in between) never
      // ran onClipDrag, so the clip was never spliced out of its track array.
      // Skip the reposition/rebuild entirely in that case — otherwise we'd
      // push a duplicate of the clip into the track, and rebuilding the
      // timeline DOM here would replace the clip element out from under the
      // browser's pending 'click' event, so a plain click could never
      // select the clip or open the properties panel.
      if (!justDragged) return;

      const target = document.elementFromPoint(e.clientX, e.clientY);
      const targetTrack = target?.closest?.('.track');
      let targetTrackIndex = sourceTrackIndex;

      if (targetTrack) {
        targetTrack.classList.remove('drag-over');
        targetTrackIndex = parseInt(targetTrack.dataset.trackIndex || targetTrack.id.replace('track-', ''), 10);
      }

      const fromClips = state.timeline.tracks[String(sourceTrackIndex)];

      if (targetTrackIndex === sourceTrackIndex) {
        // Same track - check overlap
        const overlap = fromClips.find((c) => {
          if (c.id === clip.id) return false;
          const otherStart = c.timelineStart || 0;
          const otherEnd = otherStart + (c.sourceOut - c.sourceIn);
          const clipEnd = clip.timelineStart + duration;
          return clip.timelineStart < otherEnd && otherStart < clipEnd;
        });
        if (overlap) {
          clip.timelineStart = originalStart;
        }
        fromClips.push(clip);
      } else {
        // Different track
        const toClips = state.timeline.tracks[String(targetTrackIndex)];
        const overlap = toClips.find((c) => {
          const otherStart = c.timelineStart || 0;
          const otherEnd = otherStart + (c.sourceOut - c.sourceIn);
          const clipEnd = clip.timelineStart + duration;
          return clip.timelineStart < otherEnd && otherStart < clipEnd;
        });

        if (!overlap) {
          clip.trackIndex = targetTrackIndex;
          toClips.push(clip);
        } else {
          clip.timelineStart = originalStart;
          fromClips.push(clip);
        }
      }

      recalcTotalDuration();
      renderTimeline();
      renderCanvas();
    }
  }

  function startClipResize(e, clip, trackIndex, side) {
    const startX = e.clientX;
    const originalIn = clip.sourceIn;
    const originalOut = clip.sourceOut;
    const media = state.mediaLibrary.find((m) => m.id === clip.sourceId);

    document.addEventListener('mousemove', onClipResize);
    document.addEventListener('mouseup', onClipResizeEnd);

    function onClipResize(e) {
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

      renderTimeline();
      renderCanvas();
    }

    function onClipResizeEnd() {
      document.removeEventListener('mousemove', onClipResize);
      document.removeEventListener('mouseup', onClipResizeEnd);
      recalcTotalDuration();
      renderTimeline();
      renderCanvas();
    }
  }

  // ======================== CLIP SPLIT ========================
  function splitClipAtPlayhead() {
    for (let trackIndex = 0; trackIndex <= 3; trackIndex++) {
      const clips = state.timeline.tracks[String(trackIndex)];
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const clipStart = clip.timelineStart || 0;
        const clipEnd = clipStart + (clip.sourceOut - clip.sourceIn);

        if (state.playhead > clipStart && state.playhead < clipEnd) {
          const splitTimeInClip = state.playhead - clipStart;
          const splitSourceTime = clip.sourceIn + splitTimeInClip;

          const newClip = {
            id: 'clip_' + crypto.randomUUID().replace(/-/g, ''),
            sourceId: clip.sourceId,
            type: clip.type || 'video',
            sourceIn: splitSourceTime,
            sourceOut: clip.sourceOut,
            timelineStart: clipStart + splitTimeInClip,
            trackIndex: trackIndex,
          };

          if (clip.type === 'video') {
            newClip.x = clip.x;
            newClip.y = clip.y;
            newClip.width = clip.width;
            newClip.height = clip.height;
            newClip.opacity = clip.opacity;
          }

          clip.sourceOut = splitSourceTime;
          clips.splice(i + 1, 0, newClip);

          recalcTotalDuration();
          renderTimeline();
          renderCanvas();
          return;
        }
      }
    }
  }

  // ======================== DELETE CLIP ========================
  function deleteClip(clip) {
    for (let trackIndex = 0; trackIndex <= 3; trackIndex++) {
      const clips = state.timeline.tracks[String(trackIndex)];
      const idx = clips.indexOf(clip);
      if (idx !== -1) {
        clips.splice(idx, 1);
        recalcTotalDuration();
        renderTimeline();
        renderCanvas();
        clearSelection();
        return;
      }
    }
  }

  // ======================== CANVAS PREVIEW ========================
  let pendingRender = false;
  let pendingPlayhead = 0;

  function renderCanvas() {
    if (pendingRender) return;
    pendingRender = true;
    pendingPlayhead = state.playhead;

    requestAnimationFrame(() => {
      pendingRender = false;
      doRenderCanvas(pendingPlayhead);
    });
  }

  function doRenderCanvas(playheadTime) {
    let anyClipReady = false;

    // Clear the offscreen canvas to black before drawing this frame's clips.
    // Without this, pixels from the previous frame (or from a lower-opacity
    // clip on track 1) stay on the canvas and blend with whatever is drawn
    // next, so a clip's opacity slider looks like it has no effect — you're
    // seeing new (partially transparent) pixels composited on top of old,
    // fully-opaque ones instead of on top of a clean background.
    offCtx.globalAlpha = 1.0;
    offCtx.fillStyle = '#000000';
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);

    // Draw all tracks in order (0 -> 1 -> 2 -> 3)
    for (let trackIndex = 0; trackIndex <= 3; trackIndex++) {
      const clips = state.timeline.tracks[String(trackIndex)];
      for (const clip of clips) {
        const clipStart = clip.timelineStart || 0;
        const clipEnd = clipStart + (clip.sourceOut - clip.sourceIn);

        if (playheadTime >= clipStart && playheadTime < clipEnd) {
          const media = state.mediaLibrary.find((m) => m.id === clip.sourceId);
          if (media) {
            if (clip.type === 'audio') {
              // For audio-only, show a placeholder
              offCtx.fillStyle = '#1e293b';
              offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
              offCtx.fillStyle = '#94a3b8';
              offCtx.font = '20px sans-serif';
              offCtx.textAlign = 'center';
              offCtx.fillText('🎵 Audio Only', offscreen.width / 2, offscreen.height / 2);
              anyClipReady = true;
            } else if (media.contentType && media.contentType.startsWith('image/')) {
              // Image clip
              const img = getImageElement(clip.sourceId);
              if (img && img.complete && img.naturalWidth > 0) {
                let w, h, x, y;
                if (trackIndex === 0) {
                  w = offscreen.width;
                  h = offscreen.height;
                  x = 0;
                  y = 0;
                } else {
                  w = clip.width || media.width || offscreen.width;
                  h = clip.height || media.height || offscreen.height;
                  x = clip.x !== undefined ? clip.x : (offscreen.width - w) / 2;
                  y = clip.y !== undefined ? clip.y : (offscreen.height - h) / 2;
                }

                const opacity = clip.opacity !== undefined ? clip.opacity : 1.0;
                offCtx.globalAlpha = opacity;
                offCtx.drawImage(img, x, y, w, h);
                offCtx.globalAlpha = 1.0;
                anyClipReady = true;
              }
            } else {
              // Video clip
              const videoEl = getVideoElement(clip.sourceId);

              let w, h, x, y;
              if (trackIndex === 0) {
                w = offscreen.width;
                h = offscreen.height;
                x = 0;
                y = 0;
              } else {
                w = clip.width || media.width || offscreen.width;
                h = clip.height || media.height || offscreen.height;
                x = clip.x !== undefined ? clip.x : (offscreen.width - w) / 2;
                y = clip.y !== undefined ? clip.y : (offscreen.height - h) / 2;
              }

              const opacity = clip.opacity !== undefined ? clip.opacity : 1.0;

              if (videoEl && videoEl.readyState >= 2) {
                const clipLocalTime = playheadTime - clipStart;
                const sourceTime = clip.sourceIn + clipLocalTime;

                if (Math.abs(videoEl.currentTime - sourceTime) > 0.1) {
                  videoEl.currentTime = sourceTime;
                }
              }

              // Draw the live video frame when ready; otherwise fall back to
              // the last good frame so a momentary seek/buffer stall (very
              // common right after setting currentTime every render tick)
              // doesn't make the clip vanish for a frame. Without this,
              // an overlay flickers on and off whenever it sits on top of
              // the main track, because the main track is redrawn full-canvas
              // first and briefly shows through where the overlay should be.
              if (drawVideoFrame(clip.sourceId, videoEl, x, y, w, h, opacity)) {
                anyClipReady = true;
              }
            }
          }
        }
      }
    }

    // Copy offscreen canvas to visible canvas in one operation
    ctx.drawImage(offscreen, 0, 0);
  }

  // Hidden video elements pool
  const videoPool = new Map();

  // Last-good-frame cache, keyed by mediaId. Holds a small canvas with the
  // most recent successfully-decoded frame for each video so playback can
  // keep drawing something during the brief 'not ready' window that follows
  // every currentTime seek, instead of skipping the draw for that frame.
  const frameCache = new Map();

  function drawVideoFrame(mediaId, videoEl, x, y, w, h, opacity) {
    let source = null;

    if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      let cache = frameCache.get(mediaId);
      if (!cache) {
        cache = { canvas: document.createElement('canvas'), ctx: null };
        cache.ctx = cache.canvas.getContext('2d');
        frameCache.set(mediaId, cache);
      }
      if (cache.canvas.width !== videoEl.videoWidth || cache.canvas.height !== videoEl.videoHeight) {
        cache.canvas.width = videoEl.videoWidth;
        cache.canvas.height = videoEl.videoHeight;
      }
      cache.ctx.drawImage(videoEl, 0, 0, cache.canvas.width, cache.canvas.height);
      source = videoEl;
    } else {
      const cache = frameCache.get(mediaId);
      if (cache) source = cache.canvas;
    }

    if (!source) return false;

    offCtx.globalAlpha = opacity;
    offCtx.drawImage(source, x, y, w, h);
    offCtx.globalAlpha = 1.0;
    return true;
  }

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

  // Hidden image elements pool
  const imagePool = new Map();

  function getImageElement(mediaId) {
    if (imagePool.has(mediaId)) {
      return imagePool.get(mediaId);
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      renderCanvas();
    };
    
    img.src = `/api/media/${mediaId}/stream`;
    img.style.display = 'none';
    document.body.appendChild(img);

    imagePool.set(mediaId, img);
    return img;
  }

  // ======================== PLAYBACK ========================
  let lastFrameTime = 0;

  function startPlayback() {
    if (state.isPlaying) return;
    if (state.totalDuration <= 0) return;
    if (state.playhead >= state.totalDuration) state.playhead = 0;
    state.isPlaying = true;
    setPlayButtonState(true);
    lastFrameTime = performance.now();
    playLoop();
  }

  function stopPlayback() {
    state.isPlaying = false;
    setPlayButtonState(false);
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

  // ======================== SPLIT ========================
  splitBtn.addEventListener('click', () => {
    if (state.timeline.tracks['0'].length === 0) return;
    splitClipAtPlayhead();
  });

  // ======================== EXPORT ========================
  exportBtn.addEventListener('click', async () => {
    const mainClips = state.timeline.tracks['0'];
    if (!mainClips || mainClips.length === 0) {
      exportStatus.textContent = 'No clips in timeline';
      return;
    }

    exportBtn.disabled = true;
    exportStatus.textContent = 'Starting export...';

    // Add duration to timeline for backend
    const timelineData = {
      ...state.timeline,
      duration: mainClips.reduce((s, c) => s + ((c.sourceOut || 0) - (c.sourceIn || 0)), 0),
    };

    try {
      const resp = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(timelineData),
      });

      if (resp.status === 400) {
        const data = await resp.json();
        exportStatus.textContent = 'Validation error: ' + (data.errors?.[0] || 'Unknown error');
        exportBtn.disabled = false;
        return;
      }

      if (resp.status === 429) {
        exportStatus.textContent = 'Export busy, please wait...';
        exportBtn.disabled = false;
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
          exportStatus.textContent = 'Export complete!';
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
    loadMediaLibrary();
    setupTracks();
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

