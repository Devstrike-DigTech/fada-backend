import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@infra/database/prisma.service';
import { CloudinaryService } from '@infra/storage/cloudinary.service';
import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /** Updates the signed-in user's name wherever their kind of account keeps it. */
  async updateMe(userId: string, dto: UpdateMeDto) {
    const data = {
      ...(dto.firstName && { firstName: dto.firstName }),
      ...(dto.lastName && { lastName: dto.lastName }),
    };
    if (!Object.keys(data).length) {
      throw new BadRequestException('Nothing to update');
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      include: { pharmacistProfile: true, customerProfile: true },
    });
    if (user.pharmacistProfile) {
      await this.prisma.pharmacistProfile.update({ where: { userId }, data });
    }
    if (user.customerProfile) {
      await this.prisma.customerProfile.update({ where: { userId }, data });
    }
    return {
      id: user.id,
      email: user.email,
      firstName:
        data.firstName ??
        user.pharmacistProfile?.firstName ??
        user.customerProfile?.firstName ??
        user.firstName,
      lastName:
        data.lastName ??
        user.pharmacistProfile?.lastName ??
        user.customerProfile?.lastName ??
        user.lastName,
      role: user.role,
      fadaId: user.fadaId,
      avatarUrl: user.avatarUrl,
    };
  }

  async uploadAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ avatarUrl: string }> {
    if (!file) {
      throw new BadRequestException('No image file provided');
    }

    const result = await this.cloudinary.uploadImage(
      file.buffer,
      `avatars`,
      `avatar_${userId}`, // deterministic public ID — replaces previous upload automatically
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: result.url },
    });

    return { avatarUrl: result.url };
  }
}
