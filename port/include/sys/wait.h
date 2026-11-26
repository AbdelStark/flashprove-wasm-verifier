#pragma once
#include <sys/types.h>

extern "C" pid_t waitpid(pid_t pid, int *status, int options);

#define WIFEXITED(status) (((status) & 0x7f) == 0)
#define WEXITSTATUS(status) (((status) >> 8) & 0xff)
#define WTERMSIG(status) ((status) & 0x7f)
#define WIFSIGNALED(status) (WTERMSIG(status) != 0 && WTERMSIG(status) != 0x7f)
