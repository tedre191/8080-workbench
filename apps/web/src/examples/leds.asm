; Binary counter on the LEDs (port 20h).
; The switches (port 21h) set the delay: flip the high ones to slow it down.

LEDS     EQU 20h
SWITCHES EQU 21h

        ORG 0
        LXI SP, 0E000h
        MVI B, 0
loop:   MOV A, B
        OUT LEDS
        INR B
        CALL delay
        JMP loop

; Wait about (switches / 16 + 4) * 12 ms at 2 MHz.
delay:  IN SWITCHES
        RRC
        RRC
        RRC
        RRC
        ANI 0Fh
        ADI 4
        MOV D, A
dly1:   LXI H, 1000         ; 1000 x 24 T-states = 12 ms
dly2:   DCX H
        MOV A, H
        ORA L
        JNZ dly2
        DCR D
        JNZ dly1
        RET
