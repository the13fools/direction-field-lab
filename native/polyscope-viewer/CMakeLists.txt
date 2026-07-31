if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
  cmake_minimum_required(VERSION 3.24)
  project(geometry_lab_polyscope_viewer LANGUAGES CXX)
  include(FetchContent)
  FetchContent_Declare(
    polyscope
    GIT_REPOSITORY https://github.com/nmwsharp/polyscope.git
    GIT_TAG v2.6.0
    GIT_SHALLOW TRUE
  )
  FetchContent_MakeAvailable(polyscope)
endif()

add_executable(geometry-lab-viewer src/main.cpp)
target_compile_features(geometry-lab-viewer PRIVATE cxx_std_17)
target_compile_options(geometry-lab-viewer PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(geometry-lab-viewer PRIVATE polyscope nlohmann_json::nlohmann_json)
