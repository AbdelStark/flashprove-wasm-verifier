#include "vf_common.h"
#include <iostream>

static unsigned long long hex_word(u64 word) { return static_cast<unsigned long long>(word); }

int main() {
  const u64 limbs[] = {0, 1, 0xffffffffu, 0x100000000ull, 0x8000000000000000ull, FIELD_P - 1, FIELD_P, ~0ull};
  for (u64 high : limbs)
    for (u64 low : limbs) {
      const u64 base = blk::BaseField::reduce128(high, low);
      const u64 verifier = fred((u128)high << 64 | low);
      printf("reduction %016llx %016llx %016llx %016llx\n", hex_word(high), hex_word(low), hex_word(base), hex_word(verifier));
    }

  const u64 values[] = {0, 1, 0xffffffffu, 0x100000000ull, FIELD_P / 2, FIELD_P - 2, FIELD_P - 1};
  for (u64 a : values)
    for (u64 b : values)
      printf("field %016llx %016llx %016llx %016llx %016llx\n",
             hex_word(a), hex_word(b), hex_word(fadd(a, b)), hex_word(fsub(a, b)), hex_word(fmul(a, b)));

  for (string kind; std::cin >> kind;) {
    u32 domain = 0;
    size_t count = 0;
    if (kind == "H") {
      if (!(std::cin >> domain >> count)) return 2;
    } else if (kind != "TH" || !(std::cin >> count)) {
      return 2;
    }
    vector<u32> words(count);
    for (size_t i = 0; i < count; ++i) words[i] = static_cast<u32>(i + 1) * 0x89abcdefu;

    u32 state[SW];
    if (kind == "H") {
      earlier_hash_h_state(state, domain, words.data(), count);
      printf("H %u %zu ", static_cast<unsigned>(domain), count);
    } else {
      TH(state, words.data(), count);
      printf("TH %zu ", count);
    }
    for (u32 i = 0; i < (kind == "H" ? SW : DW); ++i) printf("%08x", static_cast<unsigned>(state[i]));
    puts("");
  }
  return std::cin.eof() ? 0 : 2;
}
