#include <cstddef>
#include <cstdint>
#include <unistd.h>

namespace {
constexpr uint32_t page_bytes = 65536;
constexpr uint32_t maximum_pages = 57344;
uint32_t limit_pages = 2048;
bool configured = false;
volatile uint32_t failure = 0;

[[noreturn]] void refuse_memory(uint32_t reason) {
  failure = reason;
  __builtin_trap();
}

void *check_allocation(void *result, bool nonempty) {
  if (!result && nonempty) refuse_memory(2);
  return result;
}
} // namespace

// The host sets the bound once on each fresh instance, before _start.
extern "C" __attribute__((export_name("fpv_set_memory_limit")))
uint32_t fpv_set_memory_limit(uint32_t pages) {
  if (configured || pages > maximum_pages) __builtin_trap();
  if (pages < __builtin_wasm_memory_size(0)) refuse_memory(1);
  limit_pages = pages;
  configured = true;
  return 0;
}

extern "C" __attribute__((export_name("fpv_memory_failure")))
uint32_t fpv_memory_failure() {
  return failure;
}

// wasi-libc's allocator grows the heap in positive whole pages and uses zero to query it.
extern "C" void *sbrk(intptr_t increment) {
  const auto current = static_cast<uint32_t>(__builtin_wasm_memory_size(0));
  if (!increment) return reinterpret_cast<void *>(current * page_bytes);
  if (increment < 0 || static_cast<uint32_t>(increment) % page_bytes) __builtin_trap();
  const auto pages = static_cast<uint32_t>(increment) / page_bytes;
  if (current > limit_pages || pages > limit_pages - current) refuse_memory(1);
  if (__builtin_wasm_memory_grow(0, pages) == static_cast<size_t>(-1)) refuse_memory(2);
  return reinterpret_cast<void *>(current * page_bytes);
}

extern "C" void *__real_malloc(size_t);
extern "C" void *__real_calloc(size_t, size_t);
extern "C" void *__real_realloc(void *, size_t);
extern "C" void *__real_aligned_alloc(size_t, size_t);

extern "C" void *__wrap_malloc(size_t size) {
  return check_allocation(__real_malloc(size), size != 0);
}

extern "C" void *__wrap_calloc(size_t count, size_t size) {
  return check_allocation(__real_calloc(count, size), count != 0 && size != 0);
}

extern "C" void *__wrap_realloc(void *pointer, size_t size) {
  return check_allocation(__real_realloc(pointer, size), size != 0);
}

extern "C" void *__wrap_aligned_alloc(size_t alignment, size_t size) {
  return check_allocation(__real_aligned_alloc(alignment, size), size != 0);
}
