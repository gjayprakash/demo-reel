---
name: "app-demo-reel"
description: "Make a vertical (9:16) animated product-demo reel of a web app from its real UI, with scripted cursor, captions and AI voiceover, rendered to MP4 for Instagram Reels/Shorts."
---

# App Demo Reel

Turns a web app into a polished 15–40s vertical demo video: real app screens, smooth GSAP motion, a fake cursor that taps through the flow, hook captions, a voiceover and a closing call to action. The output is a 1080x1920 H.264 MP4 at 60fps with AAC audio.

## 1. Brief (ask once, with AskUserQuestion)

- **App:** the URL, plus the source repo or connected folder if one exists. A repo gives the most faithful UI.
- **Flow:** which 3–4 moments to show (for example create, then add, then result). Each one becomes a scene.
- **Language and tone:** English, Hindi or Hinglish; playful or professional.
- **Voice:** female or male, and an Indian-English or another accent. Or no voice, or the user records their own.
- **Ending:** the call to action (URL or handle) and the target length (default about 20s).

If the user is away, use defaults: Hinglish for Indian consumer apps, a female en-IN voice, about 20s, and the URL as the call to action.

## 2. Get the real UI (best option first)

1. **Run the app from source.** Clone the repo (`gh repo clone ...`) or work in the connected folder. Run `npm i && npm run dev`, seed realistic demo data (Indian names and ₹ amounts if relevant), and open it with Playwright in the cloud workspace. These captures are pixel-true.
2. **Live site from the cloud workspace.** Use Playwright with `viewport {430x932}` and `deviceScaleFactor: 2.5` and take a screenshot of every state in the flow (before and after each tap). Use the app's own buttons and forms to get there. Never sign in with real credentials. Use a demo or test account the user provides, or a local/staging host.
3. **Cloud workspace egress blocks the site** (connect 403/DNS errors). Capture with the built-in browser on the user's computer instead (the screenshot tool, plus `javascript_tool` to read computed colours and fonts). To transfer images, return a base64 data URL from `javascript_tool`. For large strings, split them into 400-character chunks with a djb2 hash per chunk, verify locally, and re-fetch only the chunks that fail. Hand-copied base64 nearly always has an error or two.
4. **Fallback: rebuild.** Read the design tokens (`:root` CSS variables, fonts, gradients, logo) with `javascript_tool` and rebuild the screens as HTML that matches the brand exactly. Tell the user that this is a faithful recreation, not a capture.

Get fonts locally with `npm i @fontsource/<font>` and link their CSS files. Use Inter as the fallback so ₹ and other symbols always render. For emoji, use `font-family:'Noto Color Emoji'`.

## 3. Script and voiceover (the voice sets the timing)

Write one or two short lines per scene. Hook first (under 2s), then each step, then the call to action. Keep each on-screen hook line at 24 characters or fewer at 72px. Spoken lines can be longer than the captions.

Generate one audio file per scene, then read each file's length with `ffprobe -show_entries format=duration` and set the scene lengths from them, plus about 0.3s of breathing room. Try these voice options in order:

1. **edge-tts** (free neural voices): `pip install edge-tts --break-system-packages`, then `edge-tts --voice en-IN-NeerjaNeural --rate +8% --text "..." --write-media s1.mp3`. For a male voice use `en-IN-PrabhatNeural`; for Devanagari text use `hi-IN-SwaraNeural` or `hi-IN-MadhurNeural`. The en-IN voices read romanized Hinglish well. If the cloud workspace can't reach `speech.platform.bing.com`, run the same command on the user's computer with device_bash, then stage the MP3s.
2. **ElevenLabs or OpenAI TTS**, only if the user supplies an API key (`eleven_multilingual_v2` handles Hinglish best). Never ask the user to paste a key into chat if an environment variable is available.
3. **The user's own recording.** They attach it, and you cut it per scene with `ffmpeg -ss/-to`.
4. **No voice.** Captions only; say so in the reply.

Never use copyrighted music. Tell the user to add trending audio in the Instagram app before posting. If they want background music, use only a track they supply, ducked under the voice.

## 4. Build the stage (`index.html`, 1080x1920)

The layout, kept inside the Reels safe zone: hook text at y≈180–440, the app screen or panel at y≈460–1420, a step indicator at about y 1460, and nothing important below y 1560 (the Instagram caption covers it) or right of x 960 below y 1000 (the Instagram buttons).

- **App screen:** a real screenshot set inside a rounded frame, or the rebuilt HTML. Animate between states with crossfades, slides and zoom/pan (`scale` 1→1.35 onto the tapped area, then back).
- **Cursor:** an SVG arrow with a ripple. A tap scales the cursor to 0.82 and back, expands the ripple, and scales the target to 0.94.
- **Motion ideas:** counters ticking up, progress bars, rows staggering in, an SVG path drawn with a stroke-dashoffset mask, and an icon flying along the path (`getPointAtLength` plus an `atan2` rotation).
- **Captions:** big Plus Jakarta / Inter 800 hook lines. Mark gradient words like `*word*` and animate them in per word (yPercent 115→0).

**Deterministic timeline (required).** Use one paused `gsap.timeline()` and no CSS animations, `setTimeout` or real-time video. Expose:

```js
const renderers=[]; // DOM writers for counters / path-following
const counter=(el,from,f)=>{const o={v:from};renderers.push(()=>el.textContent=f(o.v));return o;};
window.seek=t=>{tl.time(t,false);renderers.forEach(r=>r());};
window.DUR=TOTAL;
// after document.fonts.load(...) for each font: build(); seek(0); window.READY=true;
```

Measure the cursor targets with `getBoundingClientRect()` before applying any initial transforms. Use absolute positions for cursor moves, not relative ones. Set scene start times from the voiceover lengths in step 3.

Before the full render, preview stills: walk `seek()` forward to about 8 timestamps, screenshot each, tile them into a contact sheet, and Read it. Fix text overflow, overlaps and safe-zone problems.

## 5. Render

The cloud workspace has 2 CPUs, so use 2 workers. Each worker renders a frame range: `seek(f/60)`, then a JPEG screenshot at quality 95, piped into ffmpeg (`-f image2pipe -c:v mjpeg -i - -c:v libx264 -crf 16 -pix_fmt yuv420p -r 60 seg_N.mp4`). Warm-walk each worker from 0 to its start in 0.25s steps first. That renders about 6 fps per worker, so 20s takes about 2 minutes. Run it in the background with nohup and poll the log.

Audio and muxing:

```bash
# place each VO clip at its scene start (ms), mix, normalise
ffmpeg -i s1.mp3 -i s2.mp3 ... -filter_complex "[0]adelay=150|150[a0];[1]adelay=2700|2700[a1];...;[a0][a1]...amix=inputs=N:normalize=0,loudnorm=I=-14:TP=-1.5[vo]" -map "[vo]" vo.wav
# optional user-supplied music, ducked under VO
#   [music]volume=0.25[m];[m][vo]sidechaincompress=threshold=0.03:ratio=8[duck];[duck][vo]amix=2
printf "file 'seg_0.mp4'\nfile 'seg_1.mp4'\n" > list.txt
ffmpeg -f concat -safe 0 -i list.txt -i vo.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart /mnt/user-data/outputs/<app>_demo_reel.mp4
```

If there is no voice, mux silent audio with `-f lavfi -i anullsrc=r=48000:cl=stereo`.

## 6. Verify, then deliver

- Use `ffprobe` to confirm the format: 1080x1920, 60/1 fps, h264 plus aac, and the expected duration.
- Pull about 10 frames with `select='eq(n,..)'`, tile them, and Read the sheet. Also check the frames on either side of each worker seam (they should continue smoothly) and check the voiceover timing against the scene changes.
- Deliver with SendUserFile. Reply in one or two sentences: what the reel shows, and the reminder to add music in the Instagram app.
- Offer to post through a connected Instagram/Zapier action only with explicit permission. Note that music can't be added through the API.

## Bundled files

- `scripts/stills.js`: `node stills.js 1.6,4.9,9.6 <outdir>` walks the timeline and saves preview PNGs.
- `scripts/render.js`: `W=2 node render.js` renders `index.html` in the current folder into `seg_N.mp4` worker segments at 60fps.
- `examples/mytripsplitter/index.html`: a complete 19.7s stage (hook text, rebuilt app panel, cursor taps, counters, a path-following plane and a CTA) to copy as a starting template. It needs `npm i gsap @fontsource/plus-jakarta-sans @fontsource/manrope` in the same folder.

Copy the scripts and template into a working folder, then follow the steps above.
