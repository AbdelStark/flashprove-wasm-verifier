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

static bool read_one(const char *path) {
  auto *file = std::fopen(path, "rb");
  if (!file) return false;
  const bool got_byte = std::fgetc(file) != EOF;
  return std::fclose(file) == 0 && got_byte;
}

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  if (!std::strcmp(argv[2], "request")) {
    if ((argc != 6 && argc != 8) || !read_one(argv[3]) || !read_one(argv[4])) return 2;
    if (argc == 8 && !read_one(argv[7])) return 2;
    std::puts("PLAN ONLY: no proof was checked");
    return 4;
  }
  if (!std::strcmp(argv[2], "spin")) {
    volatile unsigned iterations = 0;
    for (;;) iterations = iterations + 1;
  }
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
  volatile intptr_t invalid = -1;
  if (!std::strcmp(argv[2], "bad-pipe-pointer")) {
    return pipe(reinterpret_cast<int *>(invalid));
  }
  const bool bad_wait = !std::strcmp(argv[2], "bad-wait-pointer");
  const bool rejected = !std::strcmp(argv[2], "rejected");
  const bool child_trap = !std::strcmp(argv[2], "child-trap");
  if (bad_wait || rejected || child_trap || !std::strcmp(argv[2], "child")) {
    if (rejected && argc != 5) return 2;
    int fds[2];
    if (pipe(fds)) return 2;
    const pid_t pid = fork();
    if (pid < 0) return 2;
    if (!pid) {
      close(fds[0]);
      if (dup2(fds[1], STDOUT_FILENO) != STDOUT_FILENO) return 2;
      close(fds[1]);
      if (rejected) {
        std::printf("NO: rejected-stage-text %s %s\n", argv[3], argv[4]);
        std::fprintf(stderr, "stage stderr\n");
        return 1;
      }
      if (child_trap) {
        std::puts("YES");
        std::fflush(stdout);
        std::fputs("unpublished child stderr\n", stderr);
        __builtin_trap();
      }
      return try_grow(65536) == 0 ? 3 : 2;
    }
    close(fds[1]);
    char data[16];
    ssize_t size;
    while ((size = read(fds[0], data, sizeof data)) > 0) {
      if (rejected && std::fwrite(data, 1, size, stdout) != static_cast<size_t>(size)) return 2;
    }
    close(fds[0]);
    int status;
    if (waitpid(pid, bad_wait ? reinterpret_cast<int *>(invalid) : &status, 0) != pid) return 2;
    if (WIFSIGNALED(status) && WTERMSIG(status) == 6) {
      std::puts("NO: synthetic");
      return 1;
    }
    return WIFEXITED(status) ? WEXITSTATUS(status) : 2;
  }
  return 2;
}
