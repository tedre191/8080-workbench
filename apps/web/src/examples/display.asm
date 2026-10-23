; Animated pattern on the 32x32 display.
; Video memory starts at F000h: one byte per pixel, a 16-colour palette index.

VRAM    EQU 0F000h
SIZE    EQU 32

        ORG 0
        LXI SP, 0E000h
        MVI E, 0            ; frame counter
frame:  LXI H, VRAM
        MVI B, 0            ; y
row:    MVI C, 0            ; x
pixel:  MOV A, C            ; colour = (x XOR y) + frame
        XRA B
        ADD E
        ANI 0Fh
        MOV M, A
        INX H
        INR C
        MOV A, C
        CPI SIZE
        JNZ pixel
        INR B
        MOV A, B
        CPI SIZE
        JNZ row
        INR E               ; next frame
        JMP frame
