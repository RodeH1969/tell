"""
TELL — Generate new audio files (10 additions)
Run: python generate_audio_new2.py
Set key first: set ELEVENLABS_API_KEY=your_key_here
"""

import os
import requests
import time

API_KEY = os.environ.get('ELEVENLABS_API_KEY', 'YOUR_API_KEY_HERE')
VOICE_ID = '21m00Tcm4TlvDq8ikWAM'  # Rachel
MODEL_ID = 'eleven_monolingual_v1'
OUTPUT_DIR = 'public/audio'

NEW_QUESTIONS = [
    { "file": "Game1_Q7.mp3", "text": "Napoleon Bonaparte, the Emperor of France." },
    { "file": "Game1_Q8.mp3", "text": "Thomas Jefferson, an American Founding Father who served as the 2nd Vice President of the United States." },
    { "file": "Game2_Q7.mp3", "text": "Tucker Carlson, the American conservative political commentator who hosts The Tucker Carlson Show." },
    { "file": "Game2_Q8.mp3", "text": "Conor McGregor, the Irish professional mixed martial artist." },
    { "file": "Game3_Q7.mp3", "text": "Paul Newman, the American actor, filmmaker and racing car driver." },
    { "file": "Game3_Q8.mp3", "text": "Pelé, the Brazilian professional footballer." },
    { "file": "Game4_Q7.mp3", "text": "Bing Crosby, the American singer and actor." },
    { "file": "Game4_Q8.mp3", "text": "Humphrey Bogart, the American actor and cultural icon." },
    { "file": "Game5_Q7.mp3", "text": "Ernest Hemingway, the American novelist, short-story writer, and journalist." },
    { "file": "Game5_Q8.mp3", "text": "George Orwell, the English novelist, essayist, journalist, and critic." },
]

def generate_audio(text, output_path):
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": API_KEY
    }
    data = {
        "text": text,
        "model_id": MODEL_ID,
        "voice_settings": {
            "stability": 0.6,
            "similarity_boost": 0.8,
            "style": 0.2,
            "use_speaker_boost": True
        }
    }
    response = requests.post(url, json=data, headers=headers)
    if response.status_code == 200:
        with open(output_path, 'wb') as f:
            f.write(response.content)
        print(f"  ✓ {output_path}")
        return True
    else:
        print(f"  ✗ FAILED: {response.status_code} {response.text}")
        return False

def main():
    if API_KEY == 'YOUR_API_KEY_HERE':
        print("ERROR: Set ELEVENLABS_API_KEY environment variable")
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for q in NEW_QUESTIONS:
        path = os.path.join(OUTPUT_DIR, q['file'])
        if os.path.exists(path):
            print(f"  → Skipping {q['file']} (already exists)")
            continue
        generate_audio(q['text'], path)
        time.sleep(0.6)

    print("\nDone! Now commit and push public/audio/ to GitHub.")

if __name__ == '__main__':
    main()
