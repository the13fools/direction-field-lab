cmake_minimum_required(VERSION 3.24)
project(geometry_lab_kernels LANGUAGES CXX)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "This target is WebAssembly-only. Configure with the Emscripten toolchain.")
endif()

include(FetchContent)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(EIGEN_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(TINYAD_UNIT_TESTS OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
  eigen
  GIT_REPOSITORY https://gitlab.com/libeigen/eigen.git
  GIT_TAG f1df74068ea982ba88964460b534ce296c70b40d
  GIT_SHALLOW FALSE
)
FetchContent_MakeAvailable(eigen)

FetchContent_Declare(
  tinyad
  GIT_REPOSITORY https://github.com/patr-schm/TinyAD.git
  GIT_TAG 4b48d1a1a588874556a692a3abbdecd0db4c23e1
  GIT_SHALLOW FALSE
)
FetchContent_MakeAvailable(tinyad)

add_executable(gp_lab_kernels src/mass_spring.cpp)
target_compile_features(gp_lab_kernels PRIVATE cxx_std_20)
target_link_libraries(gp_lab_kernels PRIVATE TinyAD)
target_compile_options(gp_lab_kernels PRIVATE -O3 -Wall -Wextra -Wpedantic)
target_link_options(gp_lab_kernels PRIVATE
  --bind
  -O3
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createGeometryLabModule
  -sALLOW_MEMORY_GROWTH=1
  -sENVIRONMENT=worker
  -sFILESYSTEM=0
)
set_target_properties(gp_lab_kernels PROPERTIES
  SUFFIX ".js"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../public/wasm"
)
