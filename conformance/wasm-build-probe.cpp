#define main upstream_main
#include "cp_verify.cpp"
#undef main
#include <cassert>

static bool oversized;

extern "C" off_t __real_ftello(FILE *fp);
extern "C" off_t __wrap_ftello(FILE *fp) {
  return oversized ? (off_t)PTRDIFF_MAX + 5 : __real_ftello(fp);
}

// Feed the upstream parent a rejected child over stdin. The probe never runs a proof stage.
extern "C" int __wrap_pipe(int fds[2]) {
  fds[0] = STDIN_FILENO;
  fds[1] = -1;
  return 0;
}

extern "C" pid_t __wrap_fork(void) { return 42; }

extern "C" pid_t __wrap_waitpid(pid_t pid, int *status, int options) {
  assert(pid == 42 && options == 0);
  *status = 1 << 8;
  return pid;
}

int main(int argc, char **argv) {
  assert(argc == 2);
  vector<u32> words;
  bool odd = true;
  assert(readWords(argv[1], words, odd) && words.size() == 1 && !odd);
  oversized = true;
  assert(!readWords(argv[1], words, odd) && words.size() == 1);

  bool threw = false;
  try {
    std::thread worker([] { abort(); });
    worker.join();
  } catch (const std::system_error &e) {
    threw = e.code().value() == ENOSYS;
  }
  assert(threw);

  for (int threads : {1, 256}) {
    innerThreads = threads;
    refuseThrows = true;
    std::array<int, 4> visits{};
    string refusal;
    try {
      parFor(visits.size(), [&](u64 i) {
        ++visits[i];
        if (i == 1 || i == 3) refuse(std::to_string(i));
      });
    } catch (const Refusal &r) {
      refusal = r.name;
    }
    assert(refusal == "1" && refuseThrows && innerThreads == threads);
    for (int count : visits) assert(count == 1);
    refuseThrows = false;
  }
  puts("probe: file offset and parFor checks passed");

  const CpStage stage{"key", 256, [] { abort(); return 99; }};
  return cpStagesRun({stage}, "PART PASSED: key", 3, false, BAR, CpId{});
}
