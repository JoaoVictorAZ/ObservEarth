#!/usr/bin/env python3
"""
pipeline/train_fno_model.py
-----------------------------------------------------------------------------
Modelo de Previsão Meteorológica Neural: Fourier Neural Operator (FNO2d)
100% Gratuito e Open-Source para Trabalho de Campo e Doutorado em Meteorologia.

Referências:
  - Li et al. (2021) "Fourier Neural Operator for Parametric Partial Differential Equations"
  - Pathak et al. (2022) "FourCastNet: Global Weather Forecasting"

Requisitos:
    pip install torch numpy scipy xarray netCDF4
-----------------------------------------------------------------------------
"""

import sys
import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
except ImportError:
    print("[ERRO] PyTorch não instalado. Para treinar o modelo neural execute:")
    print("pip install torch numpy")
    sys.exit(1)

class SpectralConv2d(nn.Module):
    """
    Camada de Convolução Espectral 2D no domínio da frequência (FFT).
    Filtra frequências mais altas e retém modos dominantes de ondas planetárias.
    """
    def __init__(self, in_channels: int, out_channels: int, modes1: int, modes2: int):
        super().__init__()
        self.in_channels = in_channels
        self.out_channels = out_channels
        self.modes1 = modes1  # Modos latitudinais
        self.modes2 = modes2  # Modos longitudinais

        self.scale = 1.0 / (in_channels * out_channels)
        self.weights1 = nn.Parameter(
            self.scale * torch.rand(in_channels, out_channels, self.modes1, self.modes2, dtype=torch.cfloat)
        )
        self.weights2 = nn.Parameter(
            self.scale * torch.rand(in_channels, out_channels, self.modes1, self.modes2, dtype=torch.cfloat)
        )

    def compl_mul2d(self, input_tensor, weights):
        # (batch, in_channel, x, y), (in_channel, out_channel, x, y) -> (batch, out_channel, x, y)
        return torch.einsum("bixy,ioxy->boxy", input_tensor, weights)

    def forward(self, x):
        batchsize = x.shape[0]
        # FFT 2D real para complexo
        x_ft = torch.fft.rfft2(x)

        # Multiplica modos selecionados no espaço espectral
        out_ft = torch.zeros(
            batchsize, self.out_channels, x.size(-2), x.size(-1) // 2 + 1,
            dtype=torch.cfloat, device=x.device
        )
        out_ft[:, :, :self.modes1, :self.modes2] = self.compl_mul2d(
            x_ft[:, :, :self.modes1, :self.modes2], self.weights1
        )
        out_ft[:, :, -self.modes1:, :self.modes2] = self.compl_mul2d(
            x_ft[:, :, -self.modes1:, :self.modes2], self.weights2
        )

        # Transformada Inversa FFT 2D
        x = torch.fft.irfft2(out_ft, s=(x.size(-2), x.size(-1)))
        return x


class FNO2d(nn.Module):
    """
    Rede Neural FNO2d Completa para Aprendizado de Operadores Atmosféricos.
    Entrada: [T, U, V, P, Q] em t
    Saída: [T, U, V, P, Q] em t + 6h
    """
    def __init__(self, in_channels=5, out_channels=5, modes1=12, modes2=12, width=32):
        super().__init__()
        self.modes1 = modes1
        self.modes2 = modes2
        self.width = width

        self.fc0 = nn.Linear(in_channels + 2, self.width)  # +2 para coordenadas de grid (lat, lon)

        self.conv0 = SpectralConv2d(self.width, self.width, self.modes1, self.modes2)
        self.conv1 = SpectralConv2d(self.width, self.width, self.modes1, self.modes2)
        self.conv2 = SpectralConv2d(self.width, self.width, self.modes1, self.modes2)

        self.w0 = nn.Conv2d(self.width, self.width, 1)
        self.w1 = nn.Conv2d(self.width, self.width, 1)
        self.w2 = nn.Conv2d(self.width, self.width, 1)

        self.fc1 = nn.Linear(self.width, 128)
        self.fc2 = nn.Linear(128, out_channels)

    def forward(self, x):
        # x: (batch, in_channels, height, width)
        grid = self.get_grid(x.shape, x.device)
        x = torch.cat((x, grid), dim=1)
        x = x.permute(0, 2, 3, 1)
        x = self.fc0(x)
        x = x.permute(0, 3, 1, 2)

        x1 = self.conv0(x) + self.w0(x)
        x1 = F.gelu(x1)

        x2 = self.conv1(x1) + self.w1(x1)
        x2 = F.gelu(x2)

        x3 = self.conv2(x2) + self.w2(x2)
        x3 = F.gelu(x3)

        x3 = x3.permute(0, 2, 3, 1)
        x3 = self.fc1(x3)
        x3 = F.gelu(x3)
        x3 = self.fc2(x3)
        x3 = x3.permute(0, 3, 1, 2)
        return x3

    def get_grid(self, shape, device):
        batchsize, size_x, size_y = shape[0], shape[2], shape[3]
        gridx = torch.tensor(np.linspace(0, 1, size_x), dtype=torch.float)
        gridx = gridx.reshape(1, 1, size_x, 1).repeat([batchsize, 1, 1, size_y])
        gridy = torch.tensor(np.linspace(0, 1, size_y), dtype=torch.float)
        gridy = gridy.reshape(1, 1, 1, size_y).repeat([batchsize, 1, size_x, 1])
        return torch.cat((gridx, gridy), dim=1).to(device)


if __name__ == "__main__":
    print("=== Modelo Neural FNO2d (FourCastNet Style) ===")
    model = FNO2d(in_channels=5, out_channels=5, modes1=12, modes2=12, width=32)
    sample_input = torch.randn(1, 5, 180, 360)  # Grid 1° (180x360)
    out = model(sample_input)
    print(f"Formato da Entrada:  {sample_input.shape}")
    print(f"Formato da Previsão: {out.shape}")
    print("Model initialized successfully!")
