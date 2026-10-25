# libnode.so และ header มาจาก nodejs-mobile (ดาวน์โหลดตอน build ใน GitHub Actions ไว้ที่ app/libnode/)
cmake_minimum_required(VERSION 3.18.1)
project(edposnode)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(LIBNODE_DIR ${CMAKE_SOURCE_DIR}/../../../libnode)

add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES IMPORTED_LOCATION ${LIBNODE_DIR}/bin/${ANDROID_ABI}/libnode.so)

add_library(native-lib SHARED native-lib.cpp)
target_include_directories(native-lib PRIVATE ${LIBNODE_DIR}/include/node)
target_link_libraries(native-lib libnode log)
