cmake_minimum_required(VERSION 3.24)
project(geometry_processing_starter_kit LANGUAGES CXX)

include(FetchContent)
if(PROJECT_IS_TOP_LEVEL)
  include(CTest)
endif()

option(GEOMETRY_STARTER_WITH_LIBIGL "Expose libigl headers and igl::core" OFF)
option(GEOMETRY_STARTER_WITH_GEOMETRY_CENTRAL "Expose Geometry Central mesh data structures and algorithms" OFF)

# Keep these revisions aligned with the full Direction Field Lab. The
# guards let this folder build both by itself and as part of the parent repo.
if(NOT TARGET Eigen3::Eigen)
  set(EIGEN_BUILD_TESTING OFF CACHE BOOL "" FORCE)
  FetchContent_Declare(
    eigen
    GIT_REPOSITORY https://gitlab.com/libeigen/eigen.git
    GIT_TAG f1df74068ea982ba88964460b534ce296c70b40d
    GIT_SHALLOW FALSE
  )
  FetchContent_MakeAvailable(eigen)
endif()

if(NOT TARGET TinyAD)
  set(TINYAD_UNIT_TESTS OFF CACHE BOOL "" FORCE)
  FetchContent_Declare(
    tinyad
    GIT_REPOSITORY https://github.com/patr-schm/TinyAD.git
    GIT_TAG 4b48d1a1a588874556a692a3abbdecd0db4c23e1
    GIT_SHALLOW FALSE
  )
  FetchContent_MakeAvailable(tinyad)
endif()

if(NOT TARGET polyscope)
  FetchContent_Declare(
    polyscope
    GIT_REPOSITORY https://github.com/nmwsharp/polyscope.git
    GIT_TAG v2.6.0
    GIT_SHALLOW TRUE
  )
  FetchContent_MakeAvailable(polyscope)
endif()

if(GEOMETRY_STARTER_WITH_LIBIGL AND NOT TARGET igl::core)
  set(LIBIGL_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(LIBIGL_BUILD_TUTORIALS OFF CACHE BOOL "" FORCE)
  set(LIBIGL_INSTALL OFF CACHE BOOL "" FORCE)
  FetchContent_Declare(
    libigl
    GIT_REPOSITORY https://github.com/libigl/libigl.git
    GIT_TAG fdaac01bcc52888994f7afd029dcc045dd408484
    GIT_SHALLOW FALSE
  )
  FetchContent_MakeAvailable(libigl)
endif()

if(GEOMETRY_STARTER_WITH_GEOMETRY_CENTRAL AND NOT TARGET geometry-central)
  set(SUITESPARSE OFF CACHE BOOL "" FORCE)
  FetchContent_Declare(
    geometry_central
    GIT_REPOSITORY https://github.com/nmwsharp/geometry-central.git
    GIT_TAG 019669ddabda05e0f71fa3587cfb3c1dadf19cb8
    GIT_SHALLOW FALSE
  )
  FetchContent_MakeAvailable(geometry_central)
endif()

add_executable(geometry-processing-starter main.cpp)
target_compile_features(geometry-processing-starter PRIVATE cxx_std_20)
target_link_libraries(geometry-processing-starter PRIVATE TinyAD polyscope)

if(GEOMETRY_STARTER_WITH_LIBIGL)
  target_link_libraries(geometry-processing-starter PRIVATE igl::core)
  target_compile_definitions(geometry-processing-starter PRIVATE GEOMETRY_STARTER_WITH_LIBIGL=1)
endif()

if(GEOMETRY_STARTER_WITH_GEOMETRY_CENTRAL)
  target_link_libraries(geometry-processing-starter PRIVATE geometry-central)
  target_compile_definitions(geometry-processing-starter PRIVATE GEOMETRY_STARTER_WITH_GEOMETRY_CENTRAL=1)
endif()

if(BUILD_TESTING)
  add_test(NAME geometry-processing-starter-smoke COMMAND geometry-processing-starter --headless)
endif()
