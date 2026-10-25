; Binary counter on the LEDs (port 20h).
; It counts as fast as the CPU runs: try it at 30 Hz to watch it count.

LEDS    EQU 20h

        ORG 0
        MVI A, 0
loop:   OUT LEDS
        INR A
        JMP loop
