# app-demo-reel

A Claude plugin that turns a web app into a polished vertical demo video (1080×1920, 60fps MP4) for Instagram Reels and YouTube Shorts. It uses your app's real screens, a scripted cursor that taps through the flow, animated counters and captions, an AI voiceover and a closing call to action.

## Install

In Claude Code:

```
/plugin marketplace add gjayprakash/demo-reel
/plugin install app-demo-reel@gjayprakash
```

In Cowork, add the repo as a plugin from the plugin settings.

## Use

Ask Claude something like:

> Make a 20-second demo reel of https://myapp.com showing sign-up → create project → share, Hinglish voiceover, female voice.

Claude will:

1. Capture the real UI (from your repo, the live site, or your browser).
2. Write a script and generate the voiceover. Each scene lasts as long as its spoken line.
3. Build a GSAP animation stage with frame-accurate timing.
4. Render frame by frame with Playwright and ffmpeg.
5. Mix the audio and check the frames.

## Requirements

Node 18+, Playwright with Chromium, ffmpeg, and Python 3 with Pillow. For the voice: `pip install edge-tts` (free), or an ElevenLabs/OpenAI API key.

## Example

`skills/app-demo-reel/examples/mytripsplitter/` is the stage used for a MyTripSplitter (mytripsplitter.online) reel.

## License

MIT
