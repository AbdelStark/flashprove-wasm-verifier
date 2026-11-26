#include <cerrno>
#include <csignal>
#include <pthread.h>
#include <sys/wait.h>
#include <unistd.h>

// Keep libc++'s thread and lock types. Its thread constructor throws on this error.
extern "C" int pthread_create(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *) {
  return ENOSYS;
}

extern "C" int pthread_mutex_lock(pthread_mutex_t *) { return 0; }
extern "C" int pthread_mutex_unlock(pthread_mutex_t *) { return 0; }

extern "C" void (*signal(int number, void (*handler)(int)))(int) {
  if (number != SIGCHLD || handler != SIG_DFL) __builtin_trap();
  return SIG_DFL;
}
