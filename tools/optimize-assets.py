#!/usr/bin/env python3
"""ChessCheers 素材瘦身工具

做三件事（只处理 data/ 下的素材，不动代码）：
  1. 棋盘：<名字>.png|jpg → <名字>.webp（长边 1024）+ <名字>-mini.webp（长边 480，首页预览用）
  2. 结算图：结算动画/<结局>/<图>.png → 同名 .webp（长边 1600）
  3. 音频：*.wav → 同名 .m4a（AAC 40k 单声道，需要 macOS 的 afconvert）
转换成功后才删除原文件；原始素材请事先自行备份。

音频采用三级处理：先直转；遇到 24-bit 或高采样率源（AAC 编码器不接受）时，
先降为 16-bit / 32kHz 单声道再编码；两者都失败则保留原 wav 并列出原因。

为什么需要：GitHub Pages 的出口带宽有限，原始素材总量 130MB+，
其中单张棋盘 4.9MB、单张结算图 8MB、棋子语音未压缩。
转成 webp/m4a 后总量降到十分之一左右，页面才可能在弱网下打开。

依赖：Python 3 + Pillow；音频转换依赖 macOS 自带 afconvert（缺失时自动跳过音频）。
用法：
  python3 tools/optimize-assets.py            # 转换全部
  python3 tools/optimize-assets.py --dry-run  # 只报告，不写文件
"""
import os
import glob
import shutil
import subprocess
import sys
import tempfile

try:
    from PIL import Image
except ImportError:
    print('需要 Pillow：pip3 install Pillow')
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
BOARD_DIR = os.path.join(DATA, 'chessboard')
PIECE_DIR = os.path.join(DATA, 'chesspiece')

BOARD_MAX = 1024
BOARD_MINI = 480
BOARD_Q = 84
BOARD_MINI_Q = 80
RESULT_MAX = 1600
RESULT_Q = 84
AUDIO_BITRATE = 40000

DRY = '--dry-run' in sys.argv


def human(n):
    return '%.1fMB' % (n / 1048576.0) if n > 1048576 else '%dKB' % (n / 1024)


def save_webp(src, dst, max_side, quality):
    """等比缩放到长边 max_side 后存 webp；全不透明的图去掉 alpha 以进一步减小体积。"""
    im = Image.open(src)
    has_alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
    if has_alpha:
        im = im.convert('RGBA')
        if im.getchannel('A').getextrema()[0] == 255:
            im = im.convert('RGB')
    else:
        im = im.convert('RGB')
    w, h = im.size
    scale = min(1.0, float(max_side) / max(w, h))
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    if DRY:
        return 0
    im.save(dst, 'WEBP', quality=quality, method=6)
    return os.path.getsize(dst)


def convert_boards():
    print('=== 棋盘 ===')
    total_before = total_after = 0
    for src in sorted(glob.glob(os.path.join(BOARD_DIR, '*.png')) +
                      glob.glob(os.path.join(BOARD_DIR, '*.jpg')) +
                      glob.glob(os.path.join(BOARD_DIR, '*.jpeg'))):
        base = os.path.splitext(os.path.basename(src))[0]
        if base.endswith('-mini'):
            continue
        dst = os.path.join(BOARD_DIR, base + '.webp')
        mini = os.path.join(BOARD_DIR, base + '-mini.webp')
        before = os.path.getsize(src)
        size = save_webp(src, dst, BOARD_MAX, BOARD_Q)
        save_webp(src, mini, BOARD_MINI, BOARD_MINI_Q)
        after = size + (os.path.getsize(mini) if not DRY and os.path.exists(mini) else 0)
        total_before += before
        total_after += after
        print('  %-14s %8s → %7s + mini %5s' % (
            base, human(before), human(size),
            human(os.path.getsize(mini)) if not DRY and os.path.exists(mini) else '-'))
        if not DRY:
            os.remove(src)
    print('  小计：%s → %s\n' % (human(total_before), human(total_after)))


def convert_results():
    print('=== 结算图 ===')
    total_before = total_after = 0
    for src in sorted(glob.glob(os.path.join(PIECE_DIR, '*', '结算动画', '*', '*.png'))):
        dst = os.path.splitext(src)[0] + '.webp'
        before = os.path.getsize(src)
        size = save_webp(src, dst, RESULT_MAX, RESULT_Q)
        total_before += before
        total_after += size
        print('  %-46s %8s → %7s' % (
            os.path.relpath(src, PIECE_DIR), human(before), human(size)))
        if not DRY:
            os.remove(src)
    print('  小计：%s → %s\n' % (human(total_before), human(total_after)))


def run_afconvert(afconvert, args):
    """调用 afconvert，保留 stderr 供失败时说明原因。"""
    return subprocess.run([afconvert] + args, check=False,
                          stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)


def is_usable(path):
    """产物存在且不是空壳：40k AAC 即使 0.5 秒也有数 KB。"""
    return os.path.exists(path) and os.path.getsize(path) > 1024


def encode_m4a(afconvert, src, dst, tmp):
    """三级转换，返回 (是否成功, 说明)。

    1. 直转：适配多数 16-bit PCM 源；
    2. 中转：24-bit / 48kHz 源会被 AAC 编码器拒绝（!dat），
       先降为 16-bit / 32kHz 单声道再编码；
    3. 兜底：删除半成品、保留原 wav，由调用方报告原因。
    """
    r1 = run_afconvert(afconvert, ['-f', 'm4af', '-d', 'aac', '-b', str(AUDIO_BITRATE),
                                   '-c', '1', src, dst])
    if r1.returncode == 0 and is_usable(dst):
        return True, '直转'

    r2 = run_afconvert(afconvert, ['-f', 'WAVE', '-d', 'LEI16@32000', '-c', '1', src, tmp])
    if r2.returncode == 0:
        if os.path.exists(dst):
            os.remove(dst)
        r3 = run_afconvert(afconvert, ['-f', 'm4af', '-d', 'aac', '-b', str(AUDIO_BITRATE),
                                       '-c', '1', tmp, dst])
        if r3.returncode == 0 and is_usable(dst):
            return True, '16-bit 中转'

    if os.path.exists(dst):
        os.remove(dst)
    detail = (r1.stderr or r2.stderr or '').strip().splitlines()
    return False, detail[0] if detail else '未知错误'


def convert_audio():
    print('=== 音频 ===')
    afconvert = shutil.which('afconvert')
    if not afconvert:
        print('  未找到 afconvert（非 macOS），跳过音频转换\n')
        return
    total_before = total_after = 0
    failed = []
    tmp = os.path.join(tempfile.gettempdir(), 'cc-audio-16bit.wav')

    for src in sorted(glob.glob(os.path.join(PIECE_DIR, '**', '*.wav'), recursive=True)):
        rel = os.path.relpath(src, PIECE_DIR)
        dst = os.path.splitext(src)[0] + '.m4a'
        before = os.path.getsize(src)
        if DRY:
            print('  %-52s %8s → (dry)' % (rel, human(before)))
            continue

        ok, how = encode_m4a(afconvert, src, dst, tmp)
        if not ok:
            failed.append((rel, how))
            print('  ⚠️ %-46s 转换失败，保留原文件' % rel)
            print('     原因：%s' % how)
            continue

        size = os.path.getsize(dst)
        total_before += before
        total_after += size
        note = '' if how == '直转' else '（%s）' % how
        print('  %-46s %8s → %7s%s' % (rel, human(before), human(size), note))
        os.remove(src)

    if os.path.exists(tmp):
        os.remove(tmp)

    print('  小计：%s → %s\n' % (human(total_before), human(total_after)))
    if failed:
        print('  有 %d 个音频未能转换，已保留原文件：' % len(failed))
        for rel, why in failed:
            print('    - %s：%s' % (rel, why))
        print('  请检查源文件是否损坏，或手动转成 40k AAC 单声道后重跑。\n')


if __name__ == '__main__':
    print('素材目录：%s%s\n' % (DATA, '（dry-run 模式，不写文件）' if DRY else ''))
    convert_boards()
    convert_results()
    convert_audio()
    print('完成。请接着执行：node tools/scan-assets.js')
