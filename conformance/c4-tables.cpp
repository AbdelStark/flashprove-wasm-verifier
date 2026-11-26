#include "vf_common.h"

static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__, "C4 dump words are little-endian");

// Capture the constructor inputs at the digest call. The original digest and refusal still run.
static void capture_table(u32 out[DW], u32 number, const u32 *words, u64 count, u64 stride = 1) {
  earlier_hash_h_digest(out, number, words, count, stride);
  if (number != 72) return;
  if (!count || count > UINT32_MAX || stride != 1) exit(2);
  const u32 length = static_cast<u32>(count);
  if (fwrite(&length, 4, 1, stderr) != 1 || fwrite(out, 4, DW, stderr) != DW ||
      fwrite(words, 4, length, stderr) != length) exit(2);
}

#define earlier_hash_h_digest capture_table
#define CP_VERIFY_AS_A_UNIT
#include "cp_verify.cpp"
#undef earlier_hash_h_digest

// Sweep the quantized expression in runStage's ropeC over the range that rotaryServed admits.
static int sweep_rope() {
  for (u64 theta : {10000ull, 500000ull})
    for (u64 width = 2; width <= 128; width *= 2)
      for (int sine = 0; sine < 2; ++sine)
        for (u64 position = 0; position < 1024; ++position)
          for (u64 pair = 0; pair < width / 2; ++pair) {
            const double angle = (double)position * pow((double)theta, -2.0 * (double)pair / (double)width);
            const u32 entry = (u32)((i64)round((double)(1u << 12) * (sine ? sin(angle) : cos(angle))) + 4096);
            if (fwrite(&entry, 4, 1, stdout) != 1) return 2;
          }
  return fflush(stdout) ? 2 : 0;
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  if (strcmp(argv[1], "--rope-sweep") == 0) return sweep_rope();
  const CpConf conf = cpConfRead(argv[1]);
  const int status = cp_with_configured(conf.pol, conf.layoutB, conf.KL, BAR, true,
                                         [](const blk::Configured &) { return 0; });
  return fflush(stderr) ? 2 : status;
}
