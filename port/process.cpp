#include <cerrno>
#include <cstdint>
#include <sys/wait.h>
#include <unistd.h>

#define FPV_IMPORT(name) __attribute__((import_module("fpv_port"), import_name(#name)))
extern "C" FPV_IMPORT(abi_version) int32_t fpv_abi_version();
extern "C" FPV_IMPORT(pipe) int32_t fpv_pipe(int32_t *fds);
extern "C" FPV_IMPORT(fork) int32_t fpv_fork();
extern "C" FPV_IMPORT(dup2) int32_t fpv_dup2(int32_t old_fd, int32_t new_fd);
extern "C" FPV_IMPORT(waitpid) int32_t fpv_waitpid(int32_t pid, int32_t *status, int32_t flags);
#undef FPV_IMPORT

static int32_t posix_result(int32_t result) {
  if (result >= 0) return result;
  if (result < -ENOTCAPABLE) __builtin_trap();
  errno = -result;
  return -1;
}

extern "C" int pipe(int descriptors[2]) {
  if (fpv_abi_version() != 1) __builtin_trap();
  const int result = fpv_pipe(descriptors);
  if (result > 0) __builtin_trap();
  return posix_result(result);
}

extern "C" pid_t fork(void) { return posix_result(fpv_fork()); }

extern "C" int dup2(int old_fd, int new_fd) { return posix_result(fpv_dup2(old_fd, new_fd)); }

extern "C" pid_t waitpid(pid_t pid, int *status, int flags) {
  return posix_result(fpv_waitpid(pid, status, flags));
}
