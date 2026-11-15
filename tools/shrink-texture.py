"""Downscale a big source texture to a small JPEG:  python tools/shrink-texture.py <in.png> <out.jpg> [size]"""
import sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
Image.open(sys.argv[1]).convert('RGB').resize((size, size), Image.LANCZOS).save(sys.argv[2], quality=88)
