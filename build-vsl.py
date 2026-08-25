#!/usr/bin/env python3
"""VSL slide builder - UPPERCASE white/black slides via ImageMagick convert + ffmpeg."""
import os, subprocess, sys, math

W, H = 1920, 1080
OUT = "slide_images"
SCRIPT = "vsl-script.txt"
AUDIO = "vsl-audio.mp3"
FINAL = "vsl-video.mp4"
FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

os.makedirs(OUT, exist_ok=True)
lines = [l.strip() for l in open(SCRIPT) if l.strip()]
print(f"Loaded {len(lines)} slide phrases")

def font_size(wc):
    if wc <= 4: return 140
    if wc <= 8: return 100
    if wc <= 14: return 72
    return 55

def wrap(text, fs):
    # approximate: char width ~ 0.55 * font size
    max_chars = int((W * 0.85) / (fs * 0.55))
    words, wrapped, line = text.split(), [], ""
    for w in words:
        if len((line + " " + w).strip()) <= max_chars:
            line = (line + " " + w).strip()
        else:
            if line: wrapped.append(line)
            line = w
    if line: wrapped.append(line)
    return wrapped

slides = []
for i, raw in enumerate(lines, 1):
    txt = raw.upper()
    fs = font_size(len(txt.split()))
    wrapped = wrap(txt, fs)
    n = len(wrapped)
    # build caption with \n
    caption = "\\n".join(wrapped)
    out = f"{OUT}/slide_{i:03d}.png"
    # point size: convert uses points; 1px at 72dpi == 1pt
    cmd = [
        "convert", "-size", f"{W}x{H}", "xc:white",
        "-font", FONT,
        "-pointsize", str(fs),
        "-fill", "black",
        "-gravity", "center",
        "-annotate", "+0+0", caption,
        out
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"ERR slide {i}: {r.stderr[:200]}")
        sys.exit(1)
    slides.append(out)
    if i % 20 == 0: print(f"  {i} slides...")

print(f"Generated {len(slides)} slides")

# get audio duration
dur = float(subprocess.run(["ffprobe","-v","quiet","-show_entries","format=duration","-of","csv=p=0",AUDIO],capture_output=True,text=True).stdout.strip())
per = dur / len(slides)
print(f"Audio: {dur:.1f}s, {per:.2f}s per slide")

with open("slides_duration.txt", "w") as f:
    for s in slides:
        f.write(f"file '{s}'\nduration {per:.3f}\n")
    f.write(f"file '{slides[-1]}'\n")

print("Rendering video...")
cmd = ["ffmpeg","-y","-f","concat","-safe","0","-i","slides_duration.txt","-i",AUDIO,
       "-c:v","libx264","-c:a","aac","-pix_fmt","yuv420p","-preset","medium","-crf","23",
       "-b:a","192k","-shortest",FINAL]
r = subprocess.run(cmd, capture_output=True, text=True)
if r.returncode == 0:
    sz = os.path.getsize(FINAL)/1e6
    print(f"VIDEO COMPLETE: {FINAL} ({sz:.1f} MB)")
else:
    print("ffmpeg error:", r.stderr[-500:])
    sys.exit(1)
