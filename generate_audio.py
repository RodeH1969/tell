"""
TELL — ElevenLabs Question Audio Generator
==========================================
Generates MP3 audio files for all questions using ElevenLabs API.
Output files go to: public/audio/
Filename format: Game1_Q1.mp3, Game1_Q2.mp3 ... Game5_Q5.mp3

SETUP:
1. pip install requests
2. Get your ElevenLabs API key from https://elevenlabs.io → Profile → API Key
3. Set your API key below or as environment variable ELEVENLABS_API_KEY
4. Run: python generate_audio.py

VOICE:
Default voice is "Rachel" — calm, clear, authoritative.
Find other voice IDs at: https://api.elevenlabs.io/v1/voices
"""

import os
import json
import requests
import time

# ── CONFIG ──
API_KEY = os.environ.get('ELEVENLABS_API_KEY', 'YOUR_API_KEY_HERE')
VOICE_ID = '21m00Tcm4TlvDq8ikWAM'  # Rachel — change if you want different voice
MODEL_ID = 'eleven_monolingual_v1'
OUTPUT_DIR = 'public/audio'

# ── QUESTIONS ──
GAMES = [
    {
        "gameId": "Game1",
        "questions": [
            "Adam Smith, the economist who wrote The Wealth of Nations.",
            "Benjamin Franklin, who helped draft the United States Declaration of Independence.",
            "George Washington, the first President of the United States.",
            "Mozart, the Austrian musical prodigy and prolific composer.",
            "James Cook, the British Royal Navy captain, navigator, and cartographer.",
        ]
    },
    {
        "gameId": "Game2",
        "questions": [
            "Ben Shapiro, the American conservative political commentator and media host.",
            "Pete Hegseth, the United States Secretary of Defense.",
            "Randy Orton, the highly decorated American professional wrestler and actor.",
            "Richie McCaw, the legendary New Zealand rugby union player who captained the All Blacks.",
            "Robert Kennedy Junior, the political figure who is the nephew of former U.S. President John F. Kennedy.",
        ]
    },
    {
        "gameId": "Game3",
        "questions": [
            "John Newcombe, the Australian former World Number One tennis champion.",
            "Johnny Carson, the iconic American television host and comedian.",
            "Bobby Charlton, the English football legend and 1966 World Cup winner.",
            "Pierre Trudeau, the charismatic 15th Prime Minister of Canada.",
            "Richard Burton, the acclaimed Welsh actor who married Elizabeth Taylor.",
        ]
    },
    {
        "gameId": "Game4",
        "questions": [
            "Charlie Chaplin, the English comic actor, filmmaker, and composer.",
            "Edmund Hillary, the New Zealand mountaineer and first confirmed climber to reach the summit of Mount Everest.",
            "Keith Miller, the Australian Test cricketer and World War Two fighter pilot.",
            "Liberace, the flamboyant and virtuosic American pianist and entertainer.",
            "Michael Caine, the Academy Award-winning English actor renowned for his distinctive Cockney accent.",
        ]
    },
    {
        "gameId": "Game5",
        "questions": [
            "Sigmund Freud, the Austrian neurologist who founded psychoanalysis.",
            "Nikola Tesla, the inventor who designed the alternating current electricity system.",
            "Mark Twain, the author of The Adventures of Tom Sawyer and Huckleberry Finn.",
            "J.D. Salinger, the reclusive American author best known for writing The Catcher in the Rye.",
            "Winston Churchill, the two-time British Prime Minister.",
        ]
    },
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
        print(f"  ✗ FAILED {output_path}: {response.status_code} {response.text}")
        return False

def main():
    if API_KEY == 'YOUR_API_KEY_HERE':
        print("ERROR: Set your ElevenLabs API key in the script or as ELEVENLABS_API_KEY env var")
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    total = 0
    failed = 0
    
    for game in GAMES:
        game_id = game['gameId']
        print(f"\n── {game_id} ──")
        for i, question in enumerate(game['questions'], 1):
            filename = f"{game_id}_Q{i}.mp3"
            output_path = os.path.join(OUTPUT_DIR, filename)
            
            if os.path.exists(output_path):
                print(f"  → Skipping {filename} (already exists)")
                continue
            
            success = generate_audio(question, output_path)
            total += 1
            if not success:
                failed += 1
            
            # Rate limit — ElevenLabs allows ~2 requests/second on free tier
            time.sleep(0.6)
    
    print(f"\n── Done: {total - failed}/{total} generated successfully ──")
    print(f"Files saved to: {OUTPUT_DIR}/")
    print("\nNext step: commit and push the audio folder to GitHub")
    print("Then update questions.json to add audioFile field to each question")

if __name__ == '__main__':
    main()
