# KTX2 streaming fixtures

Source: https://github.com/mrdoob/three.js/tree/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/textures/ktx2

Unmodified 40×40 full-chain ETC1S and UASTC test textures. Top-left orientation, sRGB.

- `etc1s.ktx2`: 966 bytes, SHA256 `e56ddcc757fc73ff06bb0dac2a3533ce79c1e196ad895a3ff7dcc4d9de6b9d5d`.
- `uastc.ktx2`: 2560 bytes, SHA256 `21b6912cae1f074ae3eda1b751f43c36eafc7eb83f3af71f85bba2ccbafce125`.

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.


Derived fixture: uastc-zstd.ktx2 (1600 bytes, SHA256 98fbf334049044fc00f21f07fed490a1a1d4f3e1291f30abab10a45e9a25f767). Produced from the above uastc.ktx2 using Node 25.8.1 zstdCompressSync independently on each mip; KTX2 scheme set to 2, offsets/lengths rewritten with 8-byte alignment. DFD/KVD and uncompressed mip bytes are unchanged. The same MIT license applies.
