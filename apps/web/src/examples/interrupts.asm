; Timer interrupts.
; The timer (port 30h) raises RST 1 every N milliseconds. The handler at 0008h
; counts ticks on the LEDs while the main program sleeps in HLT.
; Try a breakpoint on the INR A line in the handler.

LEDS    EQU 20h
TIMER   EQU 30h

        ORG 0
        JMP main

        ORG 08h             ; RST 1 vector
tick:   PUSH PSW
        LDA count
        INR A
        STA count
        OUT LEDS
        POP PSW
        EI                  ; interrupts are disabled on entry
        RET

main:   LXI SP, 0E000h
        MVI A, 100          ; tick every 100 ms
        OUT TIMER
        EI
sleep:  HLT                 ; wait for the next interrupt
        JMP sleep

count:  DB 0
