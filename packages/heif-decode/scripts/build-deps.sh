#!/usr/bin/env bash
# Build libde265 + libheif as static libraries for the @keepic/heif-decode addon.
#
# Prerequisites:
#   - cmake >= 3.16
#   - C/C++ compiler (gcc/clang/MSVC)
#
# Usage:
#   bash scripts/build-deps.sh [source_dir]
#
# The script downloads source tarballs if [source_dir] is not provided,
# then builds static libraries into deps/lib/ and deps/include/.

set -euo pipefail

LIBDE265_VERSION="1.0.15"
LIBHEIF_VERSION="1.21.2"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
DEPS_DIR="$PKG_DIR/deps"

SOURCE_DIR="${1:-$DEPS_DIR/src}"

mkdir -p "$SOURCE_DIR" "$DEPS_DIR/lib" "$DEPS_DIR/include"

# On Windows (MSVC), node-gyp uses /MT (static CRT). Match it in CMake builds.
MSVC_RUNTIME_FLAG=""
MSVC_STATIC_DEFINES=""
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]] || command -v cl.exe &>/dev/null; then
  # CMP0091=NEW required for CMAKE_MSVC_RUNTIME_LIBRARY to take effect
  MSVC_RUNTIME_FLAG="-DCMAKE_POLICY_DEFAULT_CMP0091=NEW -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded"
  # Tell libheif that libde265 is statically linked (avoid __declspec(dllimport))
  # de265.h checks LIBDE265_STATIC_BUILD to skip dllimport on MSVC
  MSVC_STATIC_DEFINES="-DCMAKE_C_FLAGS=-DLIBDE265_STATIC_BUILD -DCMAKE_CXX_FLAGS=-DLIBDE265_STATIC_BUILD"
fi

# ---------------------------------------------------------------------------
# Download sources if not present
# ---------------------------------------------------------------------------

if [ ! -d "$SOURCE_DIR/libde265-$LIBDE265_VERSION" ]; then
  echo "Downloading libde265 v$LIBDE265_VERSION..."
  curl -fsSL "https://github.com/strukturag/libde265/archive/refs/tags/v$LIBDE265_VERSION.tar.gz" \
    -o "$SOURCE_DIR/libde265.tar.gz"
  tar -xzf "$SOURCE_DIR/libde265.tar.gz" -C "$SOURCE_DIR"
fi

if [ ! -d "$SOURCE_DIR/libheif-$LIBHEIF_VERSION" ]; then
  echo "Downloading libheif v$LIBHEIF_VERSION..."
  curl -fsSL "https://github.com/strukturag/libheif/archive/refs/tags/v$LIBHEIF_VERSION.tar.gz" \
    -o "$SOURCE_DIR/libheif.tar.gz"
  tar -xzf "$SOURCE_DIR/libheif.tar.gz" -C "$SOURCE_DIR"
fi

# ---------------------------------------------------------------------------
# Build libde265 (static)
# ---------------------------------------------------------------------------

echo "Building libde265 (static)..."
DE265_SRC="$SOURCE_DIR/libde265-$LIBDE265_VERSION"
DE265_BUILD="$DE265_SRC/build-static"

cmake -S "$DE265_SRC" -B "$DE265_BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  $MSVC_RUNTIME_FLAG \
  -DBUILD_SHARED_LIBS=OFF \
  -DENABLE_ENCODER=OFF \
  -DENABLE_DECODER=ON \
  -DCMAKE_INSTALL_PREFIX="$DEPS_DIR"

cmake --build "$DE265_BUILD" --config Release --parallel
cmake --install "$DE265_BUILD" --config Release

# ---------------------------------------------------------------------------
# Build libheif (static, with libde265)
# ---------------------------------------------------------------------------

echo "Building libheif (static)..."
HEIF_SRC="$SOURCE_DIR/libheif-$LIBHEIF_VERSION"
HEIF_BUILD="$HEIF_SRC/build-static"

cmake -S "$HEIF_SRC" -B "$HEIF_BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  $MSVC_RUNTIME_FLAG \
  $MSVC_STATIC_DEFINES \
  -DBUILD_SHARED_LIBS=OFF \
  -DWITH_EXAMPLES=OFF \
  -DWITH_GDK_PIXBUF=OFF \
  -DBUILD_TESTING=OFF \
  -DCMAKE_DISABLE_FIND_PACKAGE_Doxygen=TRUE \
  -DENABLE_PLUGIN_LOADING=OFF \
  -DWITH_LIBDE265=ON \
  -DWITH_X265=OFF \
  -DWITH_X264=OFF \
  -DWITH_AOM_DECODER=OFF \
  -DWITH_AOM_ENCODER=OFF \
  -DWITH_OpenH264_DECODER=OFF \
  -DWITH_OpenH264_ENCODER=OFF \
  -DWITH_KVAZAAR=OFF \
  -DWITH_VVDEC=OFF \
  -DWITH_VVENC=OFF \
  -DWITH_UVG266=OFF \
  -DWITH_DAV1D=OFF \
  -DWITH_SvtEnc=OFF \
  -DWITH_RAV1E=OFF \
  -DWITH_JPEG_DECODER=OFF \
  -DWITH_JPEG_ENCODER=OFF \
  -DWITH_OpenJPEG_DECODER=OFF \
  -DWITH_OpenJPEG_ENCODER=OFF \
  -DWITH_FFMPEG_DECODER=OFF \
  -DWITH_UNCOMPRESSED_CODEC=OFF \
  -DCMAKE_PREFIX_PATH="$DEPS_DIR" \
  -DCMAKE_INSTALL_PREFIX="$DEPS_DIR"

cmake --build "$HEIF_BUILD" --config Release --parallel
cmake --install "$HEIF_BUILD" --config Release

echo "Static libraries built in $DEPS_DIR/"
echo "  lib/: $(ls "$DEPS_DIR/lib/")"
echo "  include/: $(ls "$DEPS_DIR/include/")"
