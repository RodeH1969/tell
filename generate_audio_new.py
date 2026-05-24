"""
TELL — Generate NEW audio files only (6 additions)
===================================================
Run: python generate_audio_new.py
Set your API key: set ELEVENLABS_API_KEY=your_key_here
"""

import os
import requests
import time

API_KEY = os.environ.get('ELEVENLABS_API_KEY', 'YOUR_API_KEY_HERE')
VOICE_ID = '21m00Tcm4TlvDq8ikWAM'  # Rachel — change if needed
MODEL_ID = 'eleven_monolingual_v1'
OUTPUT_DIR = 'public/audio'

NEW_QUESTIONS = [
    { "file": "Game1_Q6.mp3", "text": "Voltaire, the French writer, historian, and philosopher." },
    { "file": "Game2_Q6.mp3", "text": "Nigel Farage, the British politician who has been Leader of Reform UK since 2024." },
    { "file": "Game3_Q6.mp3", "text": "Marlon Brando, the American actor regarded as one of the greatest performers in the history of cinema." },
    { "file": "Game4_Q6.mp3", "text": "Laurence Olivier, the legendary English actor and director." },
    { "file": "Game5_Q6.mp3", "text": "Henry Ford, the American industrialist and business magnate." },
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
