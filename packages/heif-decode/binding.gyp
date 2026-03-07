{
  "variables": {
    "heif_static%": "false"
  },
  "targets": [
    {
      "target_name": "heif_decode",
      "sources": ["src/heif-decode.cc"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_VERSION=8"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17"],
      "conditions": [
        ["heif_static=='true'", {
          "include_dirs": [
            "<(module_root_dir)/deps/include"
          ],
          "conditions": [
            ["OS=='win'", {
              "libraries": [
                "<(module_root_dir)/deps/lib/heif.lib",
                "<(module_root_dir)/deps/lib/de265.lib"
              ]
            }, {
              "libraries": [
                "<(module_root_dir)/deps/lib/libheif.a",
                "<(module_root_dir)/deps/lib/libde265.a",
                "-lpthread"
              ]
            }]
          ]
        }, {
          "libraries": ["-lheif"]
        }],
        ["OS=='win'", {
          "defines": ["_HAS_EXCEPTIONS=1"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++17"]
            }
          }
        }],
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "12.0"
          }
        }]
      ]
    }
  ]
}
