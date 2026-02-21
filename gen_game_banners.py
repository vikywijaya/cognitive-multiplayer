"""Generate game banner images for CaritaHub Games using Gemini API."""
import os
import sys
import time
import json
import base64
import urllib.request
import urllib.error

API_KEY = "AIzaSyC-w6yloyCZ4TDsdKwIgjUO1BTJrXuRJ6Q"
MODEL = "gemini-2.5-flash-image"
ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "caritahub-games", "public", "img"
)
os.makedirs(OUT, exist_ok=True)

STYLE = (
    "Wide banner illustration, landscape 3:1 aspect ratio, flat vector art style, "
    "bold vivid colors, clean graphic shapes, no text, no letters, no words, no numbers, "
    "no labels anywhere in the image. Suitable as a colorful game card header banner."
)

BANNERS = {
    "banner-xiangqi": (
        f"{STYLE} "
        "A dramatic overhead view of a Chinese Xiangqi chess board mid-game. "
        "Red and black carved wooden pieces on a traditional tan board with grid lines, "
        "river dividing the board in the middle. Close-up of the pieces — General, Cannons, Chariots. "
        "Rich warm tones of red, gold, and dark wood. Traditional Chinese aesthetic."
    ),

    "banner-chess": (
        f"{STYLE} "
        "A classic Western chess board seen from a dramatic low angle, white and black marble pieces "
        "facing off across the board. A white King and black Queen prominently featured. "
        "Elegant, high-contrast black and white checkered board, soft studio lighting, "
        "sophisticated and timeless composition."
    ),

    "banner-chordaidi": (
        f"{STYLE} "
        "A vibrant fan of oversized playing cards spread out — diamond, spade, heart, club suits visible. "
        "A prominent 2 of Spades card in the center, face cards fanned behind it. "
        "Bold red and black card colors, felt green table surface, dynamic fanned layout. "
        "Exciting card game energy."
    ),

    "banner-bingo": (
        f"{STYLE} "
        "Colorful bingo balls in red, blue, yellow, green, orange tumbling out of a bingo cage. "
        "A bingo card with some squares daubed in bright colors in the foreground. "
        "Festive, cheerful atmosphere. Bright primary colors against a warm background. "
        "Classic bingo hall excitement."
    ),

    "banner-boggle": (
        f"{STYLE} "
        "A grid of white letter dice cubes seen from above, each face showing a single large bold letter. "
        "Letters arranged randomly across a 4x4 grid on a rich green felt surface. "
        "Some letters highlighted in yellow as if part of a found word. "
        "Clean, crisp, bright and playful."
    ),

    "banner-singapore-trivia": (
        f"{STYLE} "
        "A vibrant panoramic skyline illustration featuring iconic Singapore landmarks: "
        "the Merlion statue, Marina Bay Sands silhouette, and colorful Peranakan shophouses. "
        "Warm sunset colors — orange, gold, and coral — reflecting on the water. "
        "Festive and proud Singapore atmosphere."
    ),

    "banner-spot-the-difference": (
        f"{STYLE} "
        "Two nearly identical colorful scenes of a Singapore hawker centre placed side by side, "
        "separated by a thin dividing line. Bright red and yellow food stalls, hanging lanterns, "
        "steam rising from woks. A large magnifying glass overlaid on one side "
        "highlighting a small circled difference. Playful, warm, inviting."
    ),

    "banner-rhythm-tap": (
        f"{STYLE} "
        "Four glowing vertical lanes — deep blue, vivid red, bright green, rich purple — "
        "with colorful rounded rectangular beat blocks cascading downward. "
        "Neon glow trails behind each block against a dark midnight background. "
        "Dynamic, energetic, arcade game atmosphere. Pulsing light effects."
    ),
}


def generate_image(prompt, output_path, retries=3):
    """Generate an image using the Gemini API."""
    payload = {
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"]
        }
    }

    data = json.dumps(payload).encode("utf-8")

    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                ENDPOINT,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read().decode("utf-8"))

            candidates = result.get("candidates", [])
            if not candidates:
                print(f"  ⚠ No candidates in response, retrying...")
                continue

            parts = candidates[0].get("content", {}).get("parts", [])
            for part in parts:
                if "inlineData" in part:
                    img_data = base64.b64decode(part["inlineData"]["data"])
                    with open(output_path, "wb") as f:
                        f.write(img_data)
                    return True
                elif "text" in part:
                    print(f"  💬 Model text: {part['text'][:120]}")

            print(f"  ⚠ No image data in response, retrying...")

        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"  ⚠ HTTP {e.code}: {body[:300]}")
            if e.code in (429, 503):
                wait = 30 * (attempt + 1)
                print(f"  ⏳ Waiting {wait}s before retry...")
                time.sleep(wait)
            else:
                print(f"  ❌ Non-retryable error")
                return False
        except Exception as e:
            print(f"  ⚠ Error: {e}")
            time.sleep(10)

    return False


def main():
    force = "--force" in sys.argv

    total = len(BANNERS)
    success = 0
    failed = []

    for i, (key, prompt) in enumerate(BANNERS.items(), 1):
        output_path = os.path.join(OUT, f"{key}.png")

        if os.path.exists(output_path) and not force:
            print(f"[{i}/{total}] ✓ {key}.png already exists, skipping")
            success += 1
            continue

        print(f"[{i}/{total}] 🎨 Generating {key}.png ...")
        ok = generate_image(prompt, output_path)
        if ok:
            size_kb = os.path.getsize(output_path) / 1024
            print(f"[{i}/{total}] ✓ {key}.png saved ({size_kb:.0f} KB)")
            success += 1
        else:
            print(f"[{i}/{total}] ❌ Failed to generate {key}.png")
            failed.append(key)

        if i < total:
            time.sleep(3)

    print(f"\n{'='*50}")
    print(f"Generated {success}/{total} images")
    if failed:
        print(f"Failed: {', '.join(failed)}")
    print(f"Output directory: {OUT}")


if __name__ == "__main__":
    main()
