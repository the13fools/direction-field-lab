cmake_minimum_required(VERSION 3.24)
project(sgi_tinyad_starter LANGUAGES CXX)

include(FetchContent)
if(PROJECT_IS_TOP_LEVEL)
  include(CTest)
endif()

# Keep these revisions aligned with the full Geometry Processing Lab. The
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

add_executable(sgi-tinyad-starter main.cpp)
target_compile_features(sgi-tinyad-starter PRIVATE cxx_std_20)
target_link_libraries(sgi-tinyad-starter PRIVATE TinyAD polyscope)

if(BUILD_TESTING)
  add_test(NAME sgi-tinyad-starter-smoke COMMAND sgi-tinyad-starter --headless)
endif()
