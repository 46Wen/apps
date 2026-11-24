#!/usr/bin/env python3
"""Copiloto de voz: genera las grabaciones de las frases con voces neuronales naturales (las de «Leer en voz alta» de
Microsoft Edge), en cada idioma y voz de apps/copiloto_voz/voces/frases.json.

En el PC (Windows, con Python e internet), desde la carpeta del repositorio:

    py -m pip install edge-tts
    py scripts\\generar_voces.py                 todas las frases, idiomas y voces (solo las que cambiaron)
    py scripts\\generar_voces.py --idioma es     solo español
    py scripts\\generar_voces.py --todo          todas otra vez, aunque no hayan cambiado

Deja apps/copiloto_voz/voces/<idioma>/<voz>/<aviso>.mp3 (p. ej. voces/es/es-ES-ElviraNeural/fin_viaje.mp3) y en cada
carpeta un .textos.json con el texto de cada archivo, para saber cuáles cambiaron. Después: git add, commit y push (o
GitHub Desktop), y el MGU Store instala la app con las voces nuevas. En el coche, Ajustes → Idioma y Voz.
"""
import argparse
import asyncio
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
VOCES = os.path.join(ROOT, 'apps', 'copiloto_voz', 'voces')


def load():
    with open(os.path.join(VOCES, 'frases.json'), encoding='utf-8') as f:
        return json.load(f)


async def generate(doc, only_lang=None, all_again=False):
    try:
        import edge_tts
    except ImportError:
        sys.exit('Falta edge-tts: ejecute primero  py -m pip install edge-tts')
    rate = doc.get('velocidad', '+0%')
    made = skipped = 0
    failed = []
    for lang, info in doc['idiomas'].items():
        if only_lang and lang != only_lang:
            continue
        for voice in info['voces']:
            out_dir = os.path.join(VOCES, lang, voice['id'])
            os.makedirs(out_dir, exist_ok=True)
            memo_file = os.path.join(out_dir, '.textos.json')
            try:
                with open(memo_file, encoding='utf-8') as f:
                    memo = json.load(f)
            except (OSError, ValueError):
                memo = {}
            for key, texts in doc['frases'].items():
                text = (texts.get(lang) or '').strip()
                out = os.path.join(out_dir, key + '.mp3')
                if not text:
                    continue
                if not all_again and memo.get(key) == [text, rate] and os.path.exists(out):
                    skipped += 1
                    continue
                try:
                    await edge_tts.Communicate(text, voice['id'], rate=rate).save(out)
                    memo[key] = [text, rate]
                    made += 1
                    print('  ' + lang + ' ' + voice['id'] + ' ' + key)
                except Exception as e:  # one failing leaves the others
                    failed.append(lang + '/' + voice['id'] + '/' + key + ': ' + str(e))
            with open(memo_file, 'w', encoding='utf-8') as f:
                json.dump(memo, f, ensure_ascii=False, indent=1)
    print('%d generadas, %d sin cambios, %d con error' % (made, skipped, len(failed)))
    for f in failed:
        print('  ERROR ' + f)
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser(description='Genera las voces de Copiloto de voz')
    ap.add_argument('--idioma', choices=['es', 'zh', 'en'])
    ap.add_argument('--todo', action='store_true', help='todas otra vez, aunque no hayan cambiado')
    a = ap.parse_args()
    sys.exit(asyncio.run(generate(load(), a.idioma, a.todo)))


if __name__ == '__main__':
    main()
