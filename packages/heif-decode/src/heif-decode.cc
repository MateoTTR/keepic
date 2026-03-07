#include <napi.h>
#include <libheif/heif_cxx.h>
#include <vector>
#include <sstream>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static std::string heif_error_to_string(const heif::Error& err) {
  std::stringstream ss;
  ss << "heif_error: " << err.get_message()
     << " (" << err.get_code() << ", " << err.get_subcode() << ")";
  return ss.str();
}

// ---------------------------------------------------------------------------
// Synchronous getInfo(buffer) → { width, height, hasAlphaChannel }
// ---------------------------------------------------------------------------

static Napi::Value GetInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "First argument must be a Buffer")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
  const uint8_t* data = buffer.Data();
  size_t length = buffer.Length();

  try {
    heif::Context ctx;
    ctx.read_from_memory_without_copy(data, length);
    auto handle = ctx.get_primary_image_handle();

    auto result = Napi::Object::New(env);
    result.Set("width", Napi::Number::New(env, handle.get_width()));
    result.Set("height", Napi::Number::New(env, handle.get_height()));
    result.Set("hasAlphaChannel",
               Napi::Boolean::New(env, handle.has_alpha_channel()));
    return result;
  } catch (const heif::Error& err) {
    Napi::Error::New(env, heif_error_to_string(err))
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
}

// ---------------------------------------------------------------------------
// Synchronous decode(buffer) → Buffer (RGBA pixels)
// ---------------------------------------------------------------------------

static Napi::Value Decode(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "First argument must be a Buffer")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
  const uint8_t* data = buffer.Data();
  size_t length = buffer.Length();

  try {
    heif::Context ctx;
    ctx.read_from_memory_without_copy(data, length);
    auto handle = ctx.get_primary_image_handle();
    auto image =
        handle.decode_image(heif_colorspace_RGB, heif_chroma_interleaved_RGBA);

    int stride;
    const uint8_t* pixels =
        image.get_plane(heif_channel_interleaved, &stride);
    size_t size = static_cast<size_t>(stride) * handle.get_height();

    return Napi::Buffer<uint8_t>::Copy(env, pixels, size);
  } catch (const heif::Error& err) {
    Napi::Error::New(env, heif_error_to_string(err))
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
}

// ---------------------------------------------------------------------------
// AsyncWorker for non-blocking decode
// decodeAsync(buffer) → Promise<{ width, height, data: Buffer }>
// ---------------------------------------------------------------------------

class DecodeAsyncWorker : public Napi::AsyncWorker {
 public:
  DecodeAsyncWorker(Napi::Env env, std::vector<uint8_t> input)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        input_(std::move(input)) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

  void Execute() override {
    try {
      heif::Context ctx;
      ctx.read_from_memory_without_copy(input_.data(), input_.size());
      auto handle = ctx.get_primary_image_handle();
      width_ = handle.get_width();
      height_ = handle.get_height();

      auto image = handle.decode_image(heif_colorspace_RGB,
                                       heif_chroma_interleaved_RGBA);
      int stride;
      const uint8_t* pixels =
          image.get_plane(heif_channel_interleaved, &stride);
      size_t size = static_cast<size_t>(stride) * height_;
      output_.assign(pixels, pixels + size);
    } catch (const heif::Error& err) {
      SetError(heif_error_to_string(err));
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    auto buf =
        Napi::Buffer<uint8_t>::Copy(env, output_.data(), output_.size());
    auto obj = Napi::Object::New(env);
    obj.Set("width", Napi::Number::New(env, width_));
    obj.Set("height", Napi::Number::New(env, height_));
    obj.Set("data", buf);
    deferred_.Resolve(obj);
  }

  void OnError(const Napi::Error& err) override {
    deferred_.Reject(err.Value());
  }

 private:
  Napi::Promise::Deferred deferred_;
  std::vector<uint8_t> input_;
  std::vector<uint8_t> output_;
  int width_ = 0;
  int height_ = 0;
};

static Napi::Value DecodeAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "First argument must be a Buffer")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
  std::vector<uint8_t> input(buffer.Data(), buffer.Data() + buffer.Length());

  auto* worker = new DecodeAsyncWorker(env, std::move(input));
  auto promise = worker->Promise();
  worker->Queue();
  return promise;
}

// ---------------------------------------------------------------------------
// Module init
// ---------------------------------------------------------------------------

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("decode", Napi::Function::New(env, Decode));
  exports.Set("decodeAsync", Napi::Function::New(env, DecodeAsync));
  exports.Set("getInfo", Napi::Function::New(env, GetInfo));
  // Alias for backward compat with libheif-node-dy
  exports.Set("get_info", Napi::Function::New(env, GetInfo));
  return exports;
}

NODE_API_MODULE(heif_decode, Init)
