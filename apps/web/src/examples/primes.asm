; Prints the primes below 250 on the terminal.
; Good for practising Step over (CALL isprime) and Step out.

DATA    EQU 11h
LIMIT   EQU 250

        ORG 0
        LXI SP, 0E000h
        LXI H, title
        CALL puts
        MVI C, 2            ; candidate
next:   CALL isprime        ; Z set if C is prime
        JNZ skip
        MOV A, C
        CALL putdec
        MVI A, ' '
        OUT DATA
skip:   INR C
        MOV A, C
        CPI LIMIT
        JC next
        MVI A, 10
        OUT DATA
        HLT

; Z flag set if C is prime. Trial division by D = 2 .. C-1.
isprime:
        MVI D, 2
ip1:    MOV A, D
        CMP C
        JNC yes             ; tried every divisor
        MOV A, C
ip2:    SUB D               ; A mod D by repeated subtraction
        JZ no               ; divides evenly
        JNC ip2
        INR D
        JMP ip1
yes:    XRA A               ; Z = 1
        RET
no:     ORI 1               ; Z = 0
        RET

; Print A as an unsigned decimal number.
putdec: PUSH B
        PUSH D
        MVI B, 0            ; B = 1 once a digit has been printed
        MVI C, 100
        CALL digit
        MVI C, 10
        CALL digit
        ADI '0'
        OUT DATA
        POP D
        POP B
        RET

; Print A / C as one digit (skipping leading zeros); return A mod C.
digit:  MVI E, '0' - 1
dg1:    INR E
        SUB C
        JNC dg1
        ADD C               ; undo the last subtraction
        MOV D, A
        MOV A, E
        CPI '0'
        JNZ dg2
        MOV A, B
        ORA A
        JZ dg3              ; leading zero
dg2:    MOV A, E
        OUT DATA
        MVI B, 1
dg3:    MOV A, D
        RET

; Print the zero-terminated string at HL.
puts:   MOV A, M
        ORA A
        RZ
        OUT DATA
        INX H
        JMP puts

title:  DB "Primes below 250:", 10, 0
