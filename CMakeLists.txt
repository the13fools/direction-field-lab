cmake_minimum_required(VERSION 3.24)
project(geometry_processing_lab LANGUAGES CXX)

include(CTest)
include(FetchContent)

option(GEOMETRY_LAB_BUILD_POLYSCOPE "Build native Polyscope applications" ON)
set(
  GEOMETRY_LAB_CALLBACK_DIR "" CACHE PATH
  "Optional directory containing browser-edited callback headers"
)

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

add_library(geometry_lab_core
  cpp/src/vertex_field_system.cpp
)
add_library(geometry-lab::core ALIAS geometry_lab_core)
target_compile_features(geometry_lab_core PUBLIC cxx_std_20)
target_include_directories(geometry_lab_core PUBLIC cpp/include)
if(GEOMETRY_LAB_CALLBACK_DIR)
  target_include_directories(
    geometry_lab_core BEFORE PUBLIC "${GEOMETRY_LAB_CALLBACK_DIR}"
  )
  message(STATUS "Using editable callbacks from ${GEOMETRY_LAB_CALLBACK_DIR}")
endif()
target_link_libraries(geometry_lab_core PUBLIC TinyAD)
target_compile_options(geometry_lab_core PRIVATE -Wall -Wextra -Wpedantic)

if(BUILD_TESTING)
  add_executable(geometry-lab-core-smoke native/tests/vertex_field_smoke.cpp)
  target_link_libraries(geometry-lab-core-smoke PRIVATE geometry-lab::core)
  add_test(NAME vertex-field-native-smoke COMMAND geometry-lab-core-smoke)
endif()

if(GEOMETRY_LAB_BUILD_POLYSCOPE)
  FetchContent_Declare(
    polyscope
    GIT_REPOSITORY https://github.com/nmwsharp/polyscope.git
    GIT_TAG v2.6.0
    GIT_SHALLOW TRUE
  )
  FetchContent_MakeAvailable(polyscope)

  add_executable(
    geometry-lab-vertex-field
    native/experiments/vertex_field_main.cpp
  )
  target_compile_features(geometry-lab-vertex-field PRIVATE cxx_std_20)
  target_compile_options(
    geometry-lab-vertex-field PRIVATE -Wall -Wextra -Wpedantic
  )
  target_link_libraries(
    geometry-lab-vertex-field PRIVATE geometry-lab::core polyscope
  )

  add_subdirectory(student-starter)
  add_subdirectory(native/polyscope-viewer)
endif()
