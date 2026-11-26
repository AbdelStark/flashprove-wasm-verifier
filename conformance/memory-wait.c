#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

static pid_t parent;
static int report_fd;

__attribute__((constructor)) static void init(void) {
  const char *fd = getenv("FPV_MEMORY_FD");
  report_fd = fd ? atoi(fd) : -1;
  parent = getpid();
}

__attribute__((destructor)) static void report_parent(void) {
  struct rusage usage;
  if (report_fd > 2 && getpid() == parent && getrusage(RUSAGE_SELF, &usage) == 0)
    dprintf(report_fd, "parent %ld\n", usage.ru_maxrss);
}

pid_t waitpid(pid_t pid, int *status, int options) {
  struct rusage usage;
  const pid_t waited = wait4(pid, status, options, &usage);
  if (report_fd > 2 && getpid() == parent && waited > 0 && status && (WIFEXITED(*status) || WIFSIGNALED(*status)))
    dprintf(report_fd, "child %ld\n", usage.ru_maxrss);
  return waited;
}
