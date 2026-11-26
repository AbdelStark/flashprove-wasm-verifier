#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <sys/wait.h>
#include <unistd.h>

static int try_grow(intptr_t bytes) {
  std::puts("YES");
  std::fflush(stdout);
  return sbrk(bytes) == reinterpret_cast<void *>(-1) ? 2 : 0;
}

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  if (!std::strcmp(argv[2], "grow")) return try_grow(65536);
  if (!std::strcmp(argv[2], "engine-grow")) return try_grow(16 * 1024 * 1024);
  if (!std::strcmp(argv[2], "allocate")) {
    if (argc != 4) return 2;
    std::puts("YES");
    std::fflush(stdout);
    void *(*volatile allocate)(size_t, size_t) = std::calloc;
    std::free(allocate(std::strtoul(argv[3], nullptr, 10), 2));
    return 0;
  }
  if (!std::strcmp(argv[2], "zero")) {
    void *(*volatile allocate)(size_t) = std::malloc;
    void *(*volatile resize)(void *, size_t) = std::realloc;
    std::free(allocate(0));
    void *data = allocate(32);
    if (!data) return 2;
    std::free(resize(data, 0));
    return 0;
  }
  if (!std::strcmp(argv[2], "child")) {
    int fds[2];
    if (pipe(fds)) return 2;
    const pid_t pid = fork();
    if (pid < 0) return 2;
    if (!pid) {
      close(fds[0]);
      if (dup2(fds[1], STDOUT_FILENO) != STDOUT_FILENO) return 2;
      close(fds[1]);
      return try_grow(65536) == 0 ? 3 : 2;
    }
    close(fds[1]);
    char data[16];
    while (read(fds[0], data, sizeof data) > 0) {}
    close(fds[0]);
    int status;
    if (waitpid(pid, &status, 0) != pid) return 2;
    if (WIFSIGNALED(status) && WTERMSIG(status) == 6) {
      std::puts("NO: synthetic");
      return 1;
    }
    return WIFEXITED(status) ? WEXITSTATUS(status) : 2;
  }
  return 2;
}
