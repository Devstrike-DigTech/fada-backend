import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@infra/database/prisma.service';
import { CloudinaryService } from '@infra/storage/cloudinary.service';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<{ avatarUrl: string }> {
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
