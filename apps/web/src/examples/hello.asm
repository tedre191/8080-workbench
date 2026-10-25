; Hello, 8080!
; Prints a greeting on the terminal, then halts.
; The terminal is a 6850-style serial port: data at 11h.

DATA    EQU 11h

        ORG 0
start:  LXI H, greeting
loop:   MOV A, M            ; next character
        ORA A               ; zero ends the string
        JZ done
        OUT DATA
        INX H
        JMP loop
done:   HLT

greeting:
        DB "Hello, 8080!", 10, 0
