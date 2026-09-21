/* Synthetic local regression for CVE-2026-85091. No external inputs/network. */
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "gzguts.h"

static int stalled_write(void) {
    int fd[2];
    unsigned char filler[4096] = {0};
    unsigned char *input;
    uint32_t random = 0x14937a2bU;
    unsigned i;
    gzFile file;
    gz_statep state;
    int written;
    if (pipe(fd) || fcntl(fd[1], F_SETFL, O_NONBLOCK) < 0) return 10;
    while (write(fd[1], filler, sizeof(filler)) > 0) {}
    if (errno != EAGAIN && errno != EWOULDBLOCK) return 11;
    file = gzdopen(fd[1], "wb");
    if (file == NULL || gzbuffer(file, 128) != 0) return 12;
    input = malloc(262144);
    if (input == NULL) return 13;
    for (i = 0; i < 262144; ++i) {
        random ^= random << 13;
        random ^= random >> 17;
        random ^= random << 5;
        input[i] = (unsigned char)random;
    }
    written = gzwrite(file, input, 262144);
    state = (gz_statep)file;
    if (!state->again || written >= 262144) return 14;
    /* Check the broken state before triggering any unsafe baseline memmove. */
    if (state->strm.avail_in != 0 || state->strm.next_in != state->in) {
        puts("BASELINE_VULNERABLE_STALE_EXTERNAL_INPUT");
        return 42;
    }
    (void)gzprintf(file, "%s", "bounded formatted output after write stall");
    if ((uintptr_t)state->strm.next_in < (uintptr_t)state->in ||
        (uintptr_t)state->strm.next_in > (uintptr_t)state->in + 2 * state->size ||
        state->strm.avail_in > 2 * state->size) return 15;
    free(input);
    (void)gzclose(file);
    close(fd[0]);
    puts("PASS_STALLED_WRITE_AND_GZPRINTF_BOUNDARY");
    return 0;
}

static int roundtrip(void) {
    int fd[2];
    const char expected[] = "zlib backport gzip roundtrip";
    char actual[sizeof(expected)] = {0};
    gzFile output, input;
    int size;
    if (pipe(fd)) return 20;
    output = gzdopen(fd[1], "wb");
    if (output == NULL || gzprintf(output, "%s", expected) != (int)strlen(expected)) return 21;
    if (gzclose(output) != Z_OK) return 22;
    input = gzdopen(fd[0], "rb");
    if (input == NULL) return 23;
    size = gzread(input, actual, sizeof(actual));
    if (size != (int)strlen(expected) || strcmp(actual, expected) != 0) return 24;
    if (gzclose(input) != Z_OK) return 25;
    puts("PASS_GZIP_ROUNDTRIP");
    return 0;
}

int main(void) {
    int result = stalled_write();
    return result ? result : roundtrip();
}
